import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'

const hashTarget = (hash) => (hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null)

// Every new page starts at the top; links with a #hash (e.g. /bulk-orders#bulk-request) open at that section.
export default function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useLayoutEffect(() => {
    const target = hashTarget(window.location.hash)
    if (target) target.scrollIntoView({ block: 'start' })
    else window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  useLayoutEffect(() => { hashTarget(hash)?.scrollIntoView({ block: 'start' }) }, [hash])
  return null
}
