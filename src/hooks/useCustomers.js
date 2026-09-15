import { useEffect, useState } from 'react'
import { SEED_CUSTOMERS } from '../data/seedCustomers'

const STORAGE_KEY = 'hinza-sales-desk-customers'

function loadInitialCustomers() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {
    // ignore corrupted storage and fall back to seed data
  }
  return SEED_CUSTOMERS
}

export function useCustomers() {
  const [customers, setCustomers] = useState(loadInitialCustomers)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customers))
  }, [customers])

  function addCustomer(customer) {
    const newCustomer = { ...customer, id: crypto.randomUUID() }
    setCustomers((prev) => [newCustomer, ...prev])
  }

  function updateCustomer(id, updates) {
    setCustomers((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    )
  }

  return { customers, addCustomer, updateCustomer }
}
