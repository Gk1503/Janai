import { useEffect, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Loader } from './UI'
import { Field } from './Forms'
import { registerSettingsFormGuard, useBeforeUnloadWarning } from '../hooks/useSettingsFormGuard'

// A client-only id for React keys and edit/remove-by-id — the backend never returns one (Stage 1's
// presentPricingSettings strips _id), and the whole list is replaced wholesale on every save anyway, so
// nothing relies on this id surviving a save/reload.
function blankRule() {
  return { id: Math.random().toString(36).slice(2), minPurchasePrice: '', maxPurchasePrice: '', openEnded: false, fixedProfit: '', profitPercent: '' }
}

function blankForm() {
  return { rules: [] }
}

// Normalises whatever the API returned onto the form shape. A never-configured store (pricingRules: [])
// renders as "no rules yet" — the illustrative example in the spec is never prepopulated here.
function toForm(settings = {}) {
  const rules = Array.isArray(settings.pricingRules) ? settings.pricingRules : []
  return {
    rules: rules.map((rule) => ({
      id: Math.random().toString(36).slice(2),
      minPurchasePrice: String(rule.minPurchasePrice ?? ''),
      maxPurchasePrice: rule.maxPurchasePrice == null ? '' : String(rule.maxPurchasePrice),
      openEnded: rule.maxPurchasePrice == null,
      fixedProfit: String(rule.fixedProfit ?? 0),
      profitPercent: String(rule.profitPercent ?? 0),
    })),
  }
}

function toPayload(form) {
  return {
    pricingRules: form.rules.map((rule) => ({
      minPurchasePrice: Number(rule.minPurchasePrice),
      maxPurchasePrice: rule.openEnded ? null : Number(rule.maxPurchasePrice),
      fixedProfit: Number(rule.fixedProfit) || 0,
      profitPercent: Number(rule.profitPercent) || 0,
    })),
  }
}

// The ephemeral client-only `id` must never affect dirty-detection or equality checks — only the real
// rule data does.
const stripIds = (rules) => rules.map(({ id: _id, ...rest }) => rest)

// Pure, exported so add/edit/delete can be unit-tested without rendering the component or simulating a
// click (this project's SSR test harness cannot fire events). The component's own handlers below are
// thin wrappers around these.
export function addPricingRule(rules) {
  return [...rules, blankRule()]
}
export function removePricingRule(rules, id) {
  return rules.filter((rule) => rule.id !== id)
}
export function updatePricingRuleField(rules, id, field, value) {
  return rules.map((rule) => (rule.id === id ? { ...rule, [field]: value } : rule))
}

// Pure, exported so it can be unit-tested without rendering the component or hitting the network.
// Mirrors backend/utils/settingsValidation.js's normalizePricingRules structurally (same boundary
// convention: minimum inclusive, maximum exclusive, at most one open-ended final range) — this is a
// courtesy early check; the backend remains the final authority and re-validates on save regardless.
export function validateUniversalPricingSettingsForm(form) {
  const errors = {}
  const parsed = []
  for (const rule of form.rules) {
    const min = Number(rule.minPurchasePrice)
    const minInvalid = rule.minPurchasePrice === '' || !Number.isFinite(min) || min < 0
    if (minInvalid) errors[`min-${rule.id}`] = 'Enter a minimum purchase price (0 or more).'

    let max = null
    let maxInvalid = false
    if (!rule.openEnded) {
      max = Number(rule.maxPurchasePrice)
      maxInvalid = rule.maxPurchasePrice === '' || !Number.isFinite(max) || max < 0
      if (maxInvalid) errors[`max-${rule.id}`] = 'Enter a maximum purchase price (0 or more).'
      else if (!minInvalid && max <= min) { errors[`max-${rule.id}`] = 'The maximum must be greater than the minimum.'; maxInvalid = true }
    }

    const fixed = Number(rule.fixedProfit) || 0
    const percent = Number(rule.profitPercent) || 0
    if (Number(rule.fixedProfit) < 0 || Number(rule.profitPercent) < 0) errors[`profit-${rule.id}`] = 'Profit values cannot be negative.'
    else if (fixed === 0 && percent === 0) errors[`profit-${rule.id}`] = 'Enter a fixed profit, a profit percentage, or both — both cannot be zero.'

    if (!minInvalid && !maxInvalid) parsed.push({ id: rule.id, min, max: rule.openEnded ? null : max })
  }

  // Cross-rule checks (overlap, open-ended position) only make sense once every individual row is
  // itself valid — a malformed row is already flagged above.
  if (parsed.length === form.rules.length && parsed.length > 1) {
    const openEnded = parsed.filter((rule) => rule.max === null);
    if (openEnded.length > 1) {
      errors.rules = 'Only one pricing rule may be open-ended (no maximum).';
    } else {
      const sorted = [...parsed].sort((a, b) => a.min - b.min);
      for (let index = 0; index < sorted.length - 1; index += 1) {
        if (sorted[index].max === null) { errors.rules = 'The open-ended pricing rule must be the final range — no rule may start above it.'; break; }
        if (sorted[index].max > sorted[index + 1].min) { errors.rules = 'These pricing ranges overlap. Adjust them so each range starts where the previous one ends.'; break; }
      }
    }
  }
  return errors
}

function rangeLabel(rule) {
  const min = rule.minPurchasePrice !== '' ? `₹${rule.minPurchasePrice}` : '₹—'
  if (rule.openEnded) return `${min} onwards`
  const max = rule.maxPurchasePrice !== '' ? `₹${rule.maxPurchasePrice}` : '₹—'
  return `${min}–${max}`
}

// Same formula as the existing individual calculator (ProductFormModal.jsx) — purchase + fixed +
// purchase*percent/100 — just shown here against this rule's own saved values, as a live example.
function profitExample(rule) {
  const purchase = Number(rule.minPurchasePrice)
  if (rule.minPurchasePrice === '' || !Number.isFinite(purchase) || purchase < 0) return 'Enter a minimum purchase price to see an example.'
  const fixed = Number(rule.fixedProfit) || 0
  const percent = Number(rule.profitPercent) || 0
  const suggested = purchase + fixed + (purchase * percent) / 100
  return `Example: a product bought for ₹${purchase.toFixed(2)} in this range suggests a selling price of ₹${suggested.toFixed(2)}.`
}

const ERROR_PREFIX = { minPurchasePrice: 'min', maxPurchasePrice: 'max', openEnded: 'max', fixedProfit: 'profit', profitPercent: 'profit' }

export default function UniversalPricingSettingsForm({ formGuardRef } = {}) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saved, setSaved] = useState(blankForm())
  const [form, setForm] = useState(blankForm())
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/settings/pricing-rules')
      const next = toForm(data.settings)
      setSaved(next)
      setForm(next)
      setLoadError('')
    } catch (requestError) {
      setLoadError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const dirty = JSON.stringify(stripIds(form.rules)) !== JSON.stringify(stripIds(saved.rules))
  useBeforeUnloadWarning(dirty)
  registerSettingsFormGuard(formGuardRef, { dirty, saving, save: doSave })

  function addRule() {
    setForm((current) => ({ rules: addPricingRule(current.rules) }))
  }
  function setRuleField(id, field, value) {
    setForm((current) => ({ rules: updatePricingRuleField(current.rules, id, field, value) }))
    setErrors((current) => ({ ...current, [`${ERROR_PREFIX[field]}-${id}`]: '', rules: '' }))
  }
  function removeRule(id) {
    setForm((current) => ({ rules: removePricingRule(current.rules, id) }))
    setErrors((current) => ({ ...current, rules: '' }))
  }

  async function doSave() {
    if (saving) return false
    const nextErrors = validateUniversalPricingSettingsForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return false
    setSaving(true)
    try {
      const { data } = await api.patch('/settings/pricing-rules', toPayload(form))
      const next = toForm(data.settings)
      setSaved(next)
      setForm(next)
      toast(data.message || 'Settings saved.')
      return true
    } catch (requestError) {
      toast(getApiError(requestError), 'error')
      return false
    } finally {
      setSaving(false)
    }
  }
  function save(event) { event.preventDefault(); doSave() }

  function discard() { setForm(saved); setErrors({}) }

  if (loading) return <Loader label="Loading settings" />
  if (loadError) return <div className="inline-error">{loadError}<button type="button" className="text-link" onClick={load}>Retry</button></div>

  return <form className="adm-settings-form" onSubmit={save} noValidate>
    <div className="adm-settings-subsection adm-settings-first">
      <h3>Universal Pricing Rules</h3>
      <p className="adm-muted">Define purchase-price ranges with a markup. When adding or editing a product, Janai suggests a selling price from the matching rule — you choose whether to apply it. Existing product prices are never changed automatically.</p>
      {errors.rules && <div className="form-error">{errors.rules}</div>}

      {!form.rules.length ? (
        <p className="adm-muted">No pricing rules yet. Add one below.</p>
      ) : (
        <div className="adm-vendor-list">
          {form.rules.map((rule, index) => <div className="adm-vendor-card" key={rule.id}>
            <div className="adm-vendor-card-head">
              <strong>{rangeLabel(rule)}</strong>
              <div className="adm-vendor-card-actions">
                <button type="button" className="adm-icon-button" aria-label={`Remove rule ${index + 1}`} onClick={() => removeRule(rule.id)}><Trash2 size={15} /></button>
              </div>
            </div>

            <div className="adm-form-grid">
              <Field label="Minimum Purchase Price (₹)" required error={errors[`min-${rule.id}`]}>
                <input type="number" min="0" step="0.01" value={rule.minPurchasePrice} onChange={(event) => setRuleField(rule.id, 'minPurchasePrice', event.target.value)} />
              </Field>
              <Field label="Maximum Purchase Price (₹)" required error={errors[`max-${rule.id}`]} hint={rule.openEnded ? 'No upper limit — this is the final range.' : undefined}>
                <input type="number" min="0" step="0.01" value={rule.maxPurchasePrice} disabled={rule.openEnded} onChange={(event) => setRuleField(rule.id, 'maxPurchasePrice', event.target.value)} />
              </Field>
              <label className="adm-hours-day field-wide"><input type="checkbox" checked={rule.openEnded} onChange={(event) => setRuleField(rule.id, 'openEnded', event.target.checked)} />No upper limit (final range)</label>
              <Field label="Fixed Profit (₹)" optional><input type="number" min="0" step="0.01" value={rule.fixedProfit} onChange={(event) => setRuleField(rule.id, 'fixedProfit', event.target.value)} /></Field>
              <Field label="Profit Percentage (%)" optional><input type="number" min="0" step="0.1" value={rule.profitPercent} onChange={(event) => setRuleField(rule.id, 'profitPercent', event.target.value)} /></Field>
            </div>
            {errors[`profit-${rule.id}`] && <div className="form-error">{errors[`profit-${rule.id}`]}</div>}
            <p className="adm-muted">{profitExample(rule)}</p>
          </div>)}
        </div>
      )}

      <button type="button" className="text-link" onClick={addRule}><Plus size={15} /> Add Rule</button>
    </div>

    <div className="adm-settings-actions">
      <button type="button" className="button button-outline" disabled={!dirty || saving} onClick={discard}>Discard Changes</button>
      <button type="submit" className="button button-primary" disabled={!dirty || saving}><Save size={15} />{saving ? 'Saving…' : 'Save Changes'}</button>
    </div>
  </form>
}
