import { useMemo, useState } from 'react'
import { useAdminReportsData } from '../../../hooks/useAdminReportsData'
import { useCompanyBalances } from '../../../hooks/useCompanyBalances'
import {
  resolvePeriodRange,
  resolvePreviousRange,
  trendGranularity,
  periodLabel,
} from '../../../utils/reportPeriods'
import {
  filterByRange,
  applyCompanyFilter,
  applyProductFilter,
  computePeriodSales,
  computeAverageInvoiceAmount,
  percentChange,
  sumPayments,
  buildSalesTrend,
  buildTopCustomers,
  buildTopProducts,
  buildOrderStatusSummary,
  buildConversionMetric,
  buildOutstandingInvoices,
  buildInvoiceTableRows,
} from '../../../utils/adminReports'
import { downloadReportExport } from '../../../utils/reportExport'
import ErrorBanner from '../../common/ErrorBanner'
import LoadingScreen from '../../common/LoadingScreen'
import ReportPeriodFilter from './ReportPeriodFilter'
import ReportSummaryCards from './ReportSummaryCards'
import SalesTrendChart from './SalesTrendChart'
import TopCustomersTable from './TopCustomersTable'
import TopProductsTable from './TopProductsTable'
import OrderStatusSummary from './OrderStatusSummary'
import OutstandingInvoicesTable from './OutstandingInvoicesTable'
import SalesInvoiceTable from './SalesInvoiceTable'
import './Reports.css'

export default function AdminReportsPage({ onOpenCustomer, onOpenInvoice }) {
  const { data, loading, error, refresh } = useAdminReportsData()

  const [presetKey, setPresetKey] = useState('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')

  const sortedCompanies = useMemo(
    () => [...(data?.companies || [])].sort((a, b) => a.name.localeCompare(b.name, 'fa')),
    [data],
  )
  const sortedProducts = useMemo(
    () => [...(data?.products || [])].sort((a, b) => (a.code || '').localeCompare(b.code || '')),
    [data],
  )

  const report = useMemo(() => {
    if (!data) return null

    const range = resolvePeriodRange(presetKey, customFrom, customTo)
    const previousRange = resolvePreviousRange(range)

    const companiesById = new Map(data.companies.map((c) => [c.id, c]))
    const invoicesById = new Map(data.invoices.map((inv) => [inv.id, inv]))
    const namesByCode = new Map(data.products.map((p) => [p.code, p.name_fa]))

    function invoicesInRange(from, to) {
      return applyCompanyFilter(filterByRange(data.invoices, 'issued_at', from, to), companyFilter)
    }
    function invoiceItemsForInvoices(invoiceList) {
      const ids = new Set(invoiceList.map((inv) => inv.id))
      return data.invoiceItems.filter((item) => ids.has(item.invoice_id))
    }
    function paymentsInRange(from, to) {
      return applyCompanyFilter(filterByRange(data.payments, 'paid_at', from, to), companyFilter)
    }

    const periodInvoices = invoicesInRange(range.from, range.to)
    const periodInvoiceItems = invoiceItemsForInvoices(periodInvoices)
    const periodPayments = paymentsInRange(range.from, range.to)
    const periodOrders = applyCompanyFilter(
      filterByRange(data.orders, 'created_at', range.from, range.to),
      companyFilter,
    )

    const previousInvoices = invoicesInRange(previousRange.from, previousRange.to)
    const previousInvoiceItems = invoiceItemsForInvoices(previousInvoices)
    const previousPayments = paymentsInRange(previousRange.from, previousRange.to)

    const periodSalesRial = computePeriodSales({
      periodInvoices,
      periodInvoiceItems,
      invoicesById,
      productFilter,
    })
    const previousSalesRial = computePeriodSales({
      periodInvoices: previousInvoices,
      periodInvoiceItems: previousInvoiceItems,
      invoicesById,
      productFilter,
    })
    const periodCollectedRial = sumPayments(periodPayments)
    const previousCollectedRial = sumPayments(previousPayments)

    const filteredProductInvoiceIds = productFilter
      ? new Set(applyProductFilter(periodInvoiceItems, productFilter).map((item) => item.invoice_id))
      : null
    const invoiceTableSource = filteredProductInvoiceIds
      ? periodInvoices.filter((inv) => filteredProductInvoiceIds.has(inv.id))
      : periodInvoices

    return {
      range,
      previousRange,
      periodSalesRial,
      salesChangePercent: percentChange(periodSalesRial, previousSalesRial),
      periodCollectedRial,
      collectedChangePercent: percentChange(periodCollectedRial, previousCollectedRial),
      orderCount: periodOrders.length,
      deliveredOrderCount: periodOrders.filter((o) => o.status === 'delivered').length,
      averageInvoiceRial: computeAverageInvoiceAmount(periodInvoices),
      trend: buildSalesTrend(periodInvoices, periodPayments, trendGranularity(range.from, range.to)),
      topCustomers: buildTopCustomers(periodInvoices, data.payments, companiesById, 8),
      topProducts: buildTopProducts(
        applyProductFilter(periodInvoiceItems, productFilter),
        invoicesById,
        namesByCode,
        8,
      ),
      statusSummary: buildOrderStatusSummary(periodOrders),
      conversion: buildConversionMetric(periodOrders),
      outstandingInvoices: buildOutstandingInvoices(
        applyCompanyFilter(data.invoices, companyFilter),
        data.payments,
        companiesById,
      ),
      invoiceTableRows: buildInvoiceTableRows(invoiceTableSource, data.payments, companiesById),
    }
  }, [data, presetKey, customFrom, customTo, companyFilter, productFilter])

  // Respects the customer filter: "مانده حساب فعلی" narrows to that one
  // company's own receivable when a customer is selected, otherwise it's
  // the total across every company.
  const balanceLookupCompanyIds = useMemo(() => {
    if (!data) return []
    return companyFilter ? [companyFilter] : data.companies.map((c) => c.id)
  }, [data, companyFilter])
  const { balanceByCompanyId, loading: balancesLoading } = useCompanyBalances(balanceLookupCompanyIds)
  const currentOutstandingRial = useMemo(() => {
    let total = 0
    for (const balance of balanceByCompanyId.values()) {
      if (balance > 0) total += balance
    }
    return total
  }, [balanceByCompanyId])

  if (loading) return <LoadingScreen text="در حال بارگذاری گزارش‌ها..." />
  if (error) return <ErrorBanner message={error} onRetry={refresh} />
  if (!data || !report) return null

  function handleExport() {
    downloadReportExport({
      invoiceRows: report.invoiceTableRows,
      topCustomers: report.topCustomers,
      topProducts: report.topProducts,
    })
  }

  return (
    <div className="admin-reports-page">
      <div className="page-toolbar">
        <h2>گزارش‌ها</h2>
        <button type="button" className="btn-secondary" onClick={handleExport}>
          خروجی CSV
        </button>
      </div>

      <ReportPeriodFilter
        presetKey={presetKey}
        onPresetChange={setPresetKey}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        companies={sortedCompanies}
        companyFilter={companyFilter}
        onCompanyFilterChange={setCompanyFilter}
        products={sortedProducts}
        productFilter={productFilter}
        onProductFilterChange={setProductFilter}
      />

      <ReportSummaryCards
        periodSalesRial={report.periodSalesRial}
        periodSalesChangePercent={report.salesChangePercent}
        periodCollectedRial={report.periodCollectedRial}
        periodCollectedChangePercent={report.collectedChangePercent}
        currentOutstandingRial={balancesLoading ? null : currentOutstandingRial}
        orderCount={report.orderCount}
        deliveredOrderCount={report.deliveredOrderCount}
        averageInvoiceRial={report.averageInvoiceRial}
      />

      <section className="reports-section">
        <h3>روند فروش و وصولی — {periodLabel(presetKey)}</h3>
        <SalesTrendChart data={report.trend} />
      </section>

      {report.conversion && (
        <section className="reports-section reports-conversion">
          <h3>نرخ تحویل سفارش‌ها</h3>
          <p className="reports-conversion-value">{report.conversion.ratePercent}٪</p>
          <p className="reports-conversion-caption">
            از {report.conversion.denominator} سفارش ثبت‌شده در این بازه، {report.conversion.numerator}{' '}
            مورد تاکنون به تحویل رسیده‌اند. سفارش‌های اخیر ممکن است هنوز در حال انجام باشند، بنابراین این
            نرخ برای بازه‌های تازه قابل افزایش است.
          </p>
        </section>
      )}

      <div className="reports-two-column">
        <section className="reports-section">
          <h3>مشتریان برتر</h3>
          <TopCustomersTable customers={report.topCustomers} onOpenCustomer={onOpenCustomer} />
        </section>
        <section className="reports-section">
          <h3>محصولات پرفروش</h3>
          <TopProductsTable products={report.topProducts} />
        </section>
      </div>

      <section className="reports-section">
        <h3>خلاصه وضعیت سفارش‌ها</h3>
        <OrderStatusSummary summary={report.statusSummary} />
      </section>

      <section className="reports-section">
        <h3>مطالبات و فاکتورهای باز</h3>
        <OutstandingInvoicesTable invoices={report.outstandingInvoices} onOpenInvoice={onOpenInvoice} />
      </section>

      <section className="reports-section">
        <h3>فاکتورها و فروش</h3>
        <SalesInvoiceTable invoices={report.invoiceTableRows} onOpenInvoice={onOpenInvoice} />
      </section>
    </div>
  )
}
