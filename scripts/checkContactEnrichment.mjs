// Contact enrichment of registered leads - regression checks. Node's
// built-in assert, run with `npm run check:contacts`. Every page fetch and
// web search is a fake - nothing here reaches the network.

import assert from 'node:assert/strict'
import { extractPhones, lookupCompanyEmail } from '../src/outreach/emailDiscovery.js'
import { contactPatchFor, enrichLeadContacts, leadsDueForContactEnrichment, takenContacts } from '../src/prospecting/leadContactEnrichment.js'
import { searchOfficialSitesForLeads } from '../src/prospecting/discoveryPipeline.js'
import { detectContactPoints } from '../src/outreach/contactPoints.js'
import { buildEmailOutreachState } from '../src/outreach/autoEmail.js'

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`ok - ${name}`)
}

function fakeSite(pages) {
  const fetched = []
  return {
    fetched,
    fetchPage: async (url) => {
      fetched.push(url)
      return url in pages ? { ok: true, text: pages[url] } : { ok: false, reason: 'HTTP 404' }
    },
  }
}

function makeClient(tables) {
  const all = { sales_leads: [], prospect_candidates: [], ...tables }
  const matches = (row, filters) => filters.every(([f, v]) => row[f] === v)
  return {
    tables: all,
    from(table) {
      return {
        select: () => {
          const filters = []
          const chain = { eq: (f, v) => (filters.push([f, v]), chain), then: (res) => res({ data: all[table].filter((r) => matches(r, filters)).map((r) => ({ ...r })), error: null }) }
          return chain
        },
        update: (patch) => ({
          eq: (f, v) => ({
            then: (res) => {
              all[table].filter((r) => r[f] === v).forEach((r) => Object.assign(r, patch))
              res({ data: null, error: null })
            },
          }),
        }),
      }
    },
  }
}

let seq = 0
function lead(o = {}) {
  seq += 1
  return { id: `lead-${seq}`, company_name: `شرکت ${seq}`, email: null, mobile: null, phone: null, website: null, status: 'new', do_not_contact: false, tags: [], created_at: `2026-09-${String(seq).padStart(2, '0')}T00:00:00Z`, ...o }
}

// --- Extraction -------------------------------------------------------------

await check('phones: tel: and WhatsApp links, strict mobiles and labelled landlines are read (Persian digits too)', () => {
  const html = `
    <a href="tel:+989124136392">تماس</a>
    <a href="https://wa.me/989193665391">واتساپ</a>
    <p>همراه: ۰۹۱۲ ۵۸۳ ۵۹۱۰</p>
    <p>تلفن: 021-88824843</p>`
  const p = extractPhones(html)
  assert.deepEqual(p.mobiles.sort(), ['09124136392', '09125835910', '09193665391'])
  assert.deepEqual(p.landlines, ['02188824843'])
})

await check('phones: prices, codes, unlabelled landlines, fax numbers and web-designer credits are NOT read', () => {
  const html = `
    <p>قیمت: 250000000 ریال - کد محصول 02188001122</p>
    <p>فکس: 021-88824844</p>
    <p>نمابر 09121111111</p>
    <footer>طراحی سایت: آژانس نمونه 09350000000 <a href="tel:02144445555">x</a></footer>
    <script>var phone = "09129999999"</script>`
  const p = extractPhones(html)
  assert.deepEqual(p.mobiles, [])
  assert.deepEqual(p.landlines, [])
})

await check('lookup: collectPhones keeps crawling past the email to the contact page; the default email-only lookup is unchanged', async () => {
  const pages = {
    'https://acme.ir/': '<title>آکمه</title> info@acme.ir <a href="/contact-us/">تماس با ما</a>',
    'https://acme.ir/contact-us/': '<p>موبایل: 09121234567</p><p>تلفن: 026-34445566</p>',
  }
  const plain = await lookupCompanyEmail({ websites: ['https://acme.ir/'], companyName: 'x', discoveredOn: 'https://acme.ir/', fetchPage: fakeSite(pages).fetchPage })
  assert.equal(plain.email, 'info@acme.ir')
  assert.equal(plain.pagesFetched, 1)
  assert.equal('mobiles' in plain, false, 'the email pipeline sees exactly the old result shape')

  const site = fakeSite(pages)
  const full = await lookupCompanyEmail({ websites: ['https://acme.ir/'], companyName: 'x', discoveredOn: 'https://acme.ir/', fetchPage: site.fetchPage, collectPhones: true })
  assert.equal(full.email, 'info@acme.ir')
  assert.equal(full.sourceUrl, 'https://acme.ir/')
  assert.deepEqual(full.mobiles, [{ number: '09121234567', sourceUrl: 'https://acme.ir/contact-us/' }])
  assert.deepEqual(full.landlines, [{ number: '02634445566', sourceUrl: 'https://acme.ir/contact-us/' }])
})

await check('lookup: a site that is not the company\'s own never yields phones', async () => {
  const { fetchPage } = fakeSite({ 'https://www.ilna.ir/': '<title>خبرگزاری ایلنا</title> تلفن: 021-11112222 09121112222' })
  const r = await lookupCompanyEmail({ websites: ['https://www.ilna.ir/news/1'], companyName: 'تولی‌پرس', fetchPage, collectPhones: true })
  assert.equal(r.status, 'identity_mismatch')
  assert.deepEqual(r.mobiles, [])
})

// --- Patch rules --------------------------------------------------------------

await check('patch: only empty fields are filled, each with its source page', () => {
  const l = lead({ phone: '021-55556666' })
  const result = { email: 'info@acme.ir', sourceUrl: 'https://acme.ir/', mobiles: [{ number: '09121234567', sourceUrl: 'https://acme.ir/contact/' }], landlines: [{ number: '02188880000', sourceUrl: 'https://acme.ir/contact/' }] }
  const { patch, added } = contactPatchFor(l, result, takenContacts([l]))
  assert.equal(patch.email, 'info@acme.ir')
  assert.equal(patch.email_source_url, 'https://acme.ir/')
  assert.equal(patch.mobile, '09121234567')
  assert.equal(patch.phone_source_url, 'https://acme.ir/contact/')
  assert.equal('phone' in patch, false, 'an admin-entered phone is never replaced')
  assert.deepEqual(added, ['email', 'mobile'])
})

await check('sources: each contact keeps the page that publishes it - two numbers from two pages keep two sources', () => {
  const l = lead()
  const result = {
    mobiles: [
      { number: '09199526911', sourceUrl: 'https://rashaplast.ir/' },
      { number: '09192512972', sourceUrl: 'https://rashaplast.ir/contact-us/' },
    ],
    landlines: [],
  }
  const { patch } = contactPatchFor(l, result, takenContacts([l]))
  assert.deepEqual(patch.contact_sources, [
    { field: 'mobile', value: '09199526911', sourceUrl: 'https://rashaplast.ir/' },
    { field: 'mobile', value: '09192512972', sourceUrl: 'https://rashaplast.ir/contact-us/' },
  ])
})

await check('sources: contacts the lead already had are linked to the page that confirms them, without changing them', () => {
  const l = lead({ email: 'info@acme.ir', mobile: '0912 123 4567', phone: '021-88880000' })
  const result = { email: 'info@acme.ir', sourceUrl: 'https://acme.ir/', mobiles: [{ number: '09121234567', sourceUrl: 'https://acme.ir/contact/' }], landlines: [{ number: '02199990000', sourceUrl: 'https://acme.ir/contact/' }] }
  const found = contactPatchFor(l, result, takenContacts([l]))
  assert.deepEqual(found.added, [])
  assert.equal('mobile' in found.patch || 'email' in found.patch || 'phone' in found.patch, false)
  assert.deepEqual(found.patch.contact_sources, [
    { field: 'email', value: 'info@acme.ir', sourceUrl: 'https://acme.ir/' },
    { field: 'mobile', value: '0912 123 4567', sourceUrl: 'https://acme.ir/contact/' },
  ], 'a landline the site does not publish gets no source')
  assert.equal(contactPatchFor({ ...l, contact_sources: found.patch.contact_sources }, result, takenContacts([l])), null, 'nothing new the second time')
})

await check('patch: a contact already on another lead is never attached', () => {
  const other = lead({ email: 'info@acme.ir', mobile: '0912 123 4567' })
  const l = lead()
  const result = { email: 'INFO@acme.ir', mobiles: [{ number: '09121234567', sourceUrl: 'u' }], landlines: [] }
  assert.equal(contactPatchFor(l, result, takenContacts([other, l])), null)
})

await check('due: only leads missing email or mobile, with a website that can be their own, not rechecked for 30 days', () => {
  const now = new Date('2026-09-24T12:00:00Z')
  const complete = lead({ email: 'a@a.ir', mobile: '09121112233', website: 'https://a.ir' })
  const completeUnsourced = lead({ email: 'b@b.ir', mobile: '09121112244', website: 'https://bb.ir' })
  complete.contact_sources = [{ field: 'email', value: 'a@a.ir', sourceUrl: 'https://a.ir/' }]
  const pdf = lead({ website: 'https://dhci.org/wp-content/uploads/2025/07/ozv.pdf' })
  const optedOut = lead({ website: 'https://b.ir', do_not_contact: true })
  const fresh = lead({ website: 'https://c.ir' })
  const recent = lead({ website: 'https://d.ir', contact_lookup_at: '2026-09-20T00:00:00Z', contact_lookup_status: 'no_email_on_site' })
  const failedYesterday = lead({ website: 'https://e.ir', contact_lookup_at: '2026-09-23T00:00:00Z', contact_lookup_status: 'fetch_failed' })
  const viaCandidate = lead({ tags: ['prospecting'] })
  const due = leadsDueForContactEnrichment([complete, completeUnsourced, pdf, optedOut, fresh, recent, failedYesterday, viaCandidate], new Map([[viaCandidate.id, { website: 'https://f.ir/p' }]]), now)
  assert.deepEqual(due.map((l) => l.id).sort(), [completeUnsourced.id, fresh.id, failedYesterday.id, viaCandidate.id].sort(), 'a complete lead is read once to record its sources')
})

// --- Enrichment runs (manual, imported, discovered) ----------------------------

await check('enrich: manual, imported and discovered leads are enriched the same way; the PDF-website lead is not fetched', async () => {
  const manual = lead({ website: 'https://manual.ir', company_name: 'شرکت دستی' })
  const imported = lead({ website: 'https://imported.ir/fa/', company_name: 'شرکت واردشده', import_batch_id: 'b1' })
  const discovered = lead({ company_name: 'فیلم پلی اتیلن', tags: ['prospecting', 'منبع:جستجوی وب (Serper / Google)'] })
  const pdfOnly = lead({ website: 'https://dhci.org/wp-content/uploads/ozv.pdf', import_batch_id: 'b1' })
  const site = fakeSite({
    'https://manual.ir/': '<title>شرکت دستی</title><a href="tel:09121110001">x</a>',
    'https://imported.ir/': '<title>واردشده صنعت</title> sales@imported.ir <p>تلفن: 031-33334444</p>',
    'https://disc.ir/': '<title>دیسک</title><a href="https://wa.me/989121110003">wa</a>',
  })
  const client = makeClient({ sales_leads: [manual, imported, discovered, pdfOnly], prospect_candidates: [{ promoted_lead_id: discovered.id, website: 'https://disc.ir/film/' }] })
  const s = await enrichLeadContacts(client, { deadline: Date.now() + 60000, maxLeads: 10, fetchPage: site.fetchPage })
  const get = (l) => client.tables.sales_leads.find((x) => x.id === l.id)
  assert.equal(get(manual).mobile, '09121110001')
  assert.equal(get(imported).email, 'sales@imported.ir')
  assert.equal(get(imported).phone, '03133334444')
  assert.equal(get(imported).phone_source_url, 'https://imported.ir/')
  assert.equal(get(discovered).mobile, '09121110003', 'the discovered lead is read on the site it was found on')
  assert.equal(get(pdfOnly).contact_lookup_at, undefined)
  assert.ok(!site.fetched.some((u) => u.includes('dhci.org')))
  assert.equal(s.updated, 3)
  assert.deepEqual([s.emailsAdded, s.mobilesAdded, s.phonesAdded], [1, 2, 1])
  // Detected by the shared contact logic -> WhatsApp/Bale and email workflows.
  assert.equal(detectContactPoints(get(manual)).whatsapp.destination, '+989121110001')
  const emailState = buildEmailOutreachState({ leads: [get(imported)] })
  assert.equal(emailState[0].state, 'ready', 'a found email enters the existing email workflow')
})

await check('enrich: two leads on the same website - the number goes to one lead only; maxLeads bounds the pass', async () => {
  const a = lead({ website: 'https://same.ir', company_name: 'همسان' })
  const b = lead({ website: 'https://same.ir/about', company_name: 'همسان' })
  const c = lead({ website: 'https://third.ir', company_name: 'سوم' })
  const site = fakeSite({ 'https://same.ir/': '<title>همسان</title> 09121119999', 'https://third.ir/': '<title>سوم</title> 09121118888' })
  const client = makeClient({ sales_leads: [a, b, c] })
  const s = await enrichLeadContacts(client, { deadline: Date.now() + 60000, maxLeads: 2, fetchPage: site.fetchPage, concurrency: 1 })
  assert.equal(s.checked, 2)
  const withNumber = client.tables.sales_leads.filter((l) => l.mobile === '09121119999')
  assert.equal(withNumber.length, 1)
})

await check('enrich: a lead whose site publishes nothing is recorded and not re-read for 30 days', async () => {
  const l = lead({ website: 'https://empty.ir', company_name: 'خالی' })
  const site = fakeSite({ 'https://empty.ir/': '<title>خالی</title> فرم تماس' })
  const client = makeClient({ sales_leads: [l] })
  await enrichLeadContacts(client, { deadline: Date.now() + 60000, maxLeads: 5, fetchPage: site.fetchPage })
  assert.equal(client.tables.sales_leads[0].contact_lookup_status, 'no_email_on_site')
  const before = site.fetched.length
  await enrichLeadContacts(client, { deadline: Date.now() + 60000, maxLeads: 5, fetchPage: site.fetchPage })
  assert.equal(site.fetched.length, before)
})

// --- Official-site search (paid) ---------------------------------------------

await check('search: an imported lead with a PDF "website" gets the email AND phone from its found official site, within the search budget', async () => {
  const l1 = lead({ company_name: 'فردوس شیمی لیا', website: 'https://dhci.org/x.pdf', email_lookup_status: 'not_official_website', import_batch_id: 'b' })
  const l2 = lead({ company_name: 'آریا شیمی رایکا', email_lookup_status: 'not_official_website' })
  const l3 = lead({ company_name: 'سپیدار شیمی مهرا', email_lookup_status: 'identity_mismatch' })
  let searches = 0
  const search = async () => {
    searches += 1
    return [{ title: 'فردوس شیمی لیا', link: 'https://ferdows-lia.ir/' }]
  }
  const site = fakeSite({ 'https://ferdows-lia.ir/': '<title>فردوس شیمی لیا</title> info@ferdows-lia.ir <p>تلفن: 028-33453914</p> 09121113333' })
  const client = makeClient({ sales_leads: [l1, l2, l3] })
  const s = await searchOfficialSitesForLeads(client, { deadline: Date.now() + 60000, maxSearches: 1, search, fetchPage: site.fetchPage })
  assert.equal(searches, 1, 'never more paid searches than the budget')
  const got = client.tables.sales_leads[0]
  assert.equal(got.email, 'info@ferdows-lia.ir')
  assert.equal(got.mobile, '09121113333')
  assert.equal(got.phone, '02833453914')
  assert.equal(got.website, 'https://dhci.org/x.pdf', 'the recorded website is left as entered')
  assert.equal(s.found, 1)
  assert.equal(s.phonesFound, 1)
})

console.log(`\n${passed} check(s) passed.`)
