import { useCallback, useEffect, useState } from 'react'

// Minimal, dependency-free path tracking so /contact can be a real,
// bookmarkable, unauthenticated route without pulling in a router library
// for what is otherwise a single-view app.
export function usePathname() {
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    function handlePopState() {
      setPathname(window.location.pathname)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((path) => {
    if (path !== window.location.pathname) {
      window.history.pushState({}, '', path)
    }
    setPathname(path)
  }, [])

  return { pathname, navigate }
}
