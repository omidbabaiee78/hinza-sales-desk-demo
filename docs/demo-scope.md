# Hinza demo: current product scope

## Goal

Discover relevant B2B companies, find a published business contact, send **one introductory message per address/channel**, and log what happened. The system does not negotiate, answer on behalf of a salesperson, or continue a conversation automatically.

## Primary admin navigation

1. Overview: live discovery and introductory email status.
2. Discover companies: sources, candidate inspection, discovery runs.
3. Leads: automatically discovered and manually entered prospects.
4. Initial contact: email queue/sent/failure tabs, plus recorded customer replies.

Orders, invoices, products, CRM and financial workflows are out of the demo's main navigation. Existing routes/data stay available for historical use. Hiding a page is not the same as deleting its data or stopping a background job.

## Current email behavior

- Autonomous discovery and email jobs run on Supabase, independently of VS Code or localhost.
- Only an address that can be contacted receives the introductory email; repeated sends to the same address are blocked.
- Keep the existing daily cap (20), per-run cap, opt-outs, bounce suppression and logged provider outcomes.
- Delivery status needs a real signed Resend webhook event before it can be called verified end to end.

## Next stages

1. Verify the next scheduled discovery/email run and an actual webhook event. Publish the focused admin UI after review.
2. Connect WhatsApp as a separate channel only when there is an authorized provider, recipient mapping and one-message duplicate protection. Show sent/delivered/failed status honestly.
3. Connect Bale as a separate channel with its own provider and status history. Do not label a channel active until a real send and result are verified.

Do not add automatic negotiation, automatic replies, or per-lead approval steps to the primary flow. The user owns follow-up and sales decisions.
