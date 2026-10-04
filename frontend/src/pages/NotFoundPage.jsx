import { ArrowLeft, Leaf } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return <section className="not-found page-container"><span className="not-found-icon"><Leaf size={25} /></span><span className="eyebrow">404 · FRESH START</span><h1>Oops! This page could not be found.</h1><p>That link may have moved. Let’s get you back to the good stuff.</p><Link className="button button-primary" to="/"><ArrowLeft size={16} />Back to Home</Link></section>
}
