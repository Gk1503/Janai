import { useRef, useState } from 'react'
import { Image as ImageIcon, Save, Settings, Tags, Upload } from 'lucide-react'
import api, { getApiError } from '../services/api'
import { useToast } from '../context/AppContexts'
import { Modal } from './UI'
import { MAX_IMAGE_BYTES, capitalizeFirst, readImageAsDataUrl } from './ProductFormModal'

function toFormState(category) {
  return {
    name: category?.name || '',
    description: category?.description || '',
    active: category ? category.status !== 'Inactive' : true,
    displayOrder: category?.displayOrder ?? '',
  }
}

export default function CategoryFormModal({ category, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(() => toFormState(category))
  const [imagePreview, setImagePreview] = useState(category?.image || '')
  const [imageError, setImageError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)
  const isEdit = Boolean(category?._id)

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function onImageSelected(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setImageError('Please choose an image file (JPG, PNG, WEBP…).'); return }
    if (file.size > MAX_IMAGE_BYTES) { setImageError('Image must be smaller than 5MB.'); return }
    try {
      const dataUrl = await readImageAsDataUrl(file)
      setImagePreview(dataUrl)
      setImageError('')
    } catch {
      setImageError('Could not read that image. Please try another file.')
    }
  }

  async function submit(event) {
    event.preventDefault()
    const trimmed = form.name.trim()
    if (!trimmed) { setError('Category name is required.'); return }
    setBusy(true)
    setError('')
    const payload = {
      name: capitalizeFirst(trimmed),
      description: form.description,
      image: imagePreview,
      status: form.active ? 'Active' : 'Inactive',
      displayOrder: form.displayOrder === '' ? undefined : Number(form.displayOrder),
    }
    try {
      if (isEdit) await api.put(`/categories/${category._id}`, payload)
      else await api.post('/categories', payload)
      toast(isEdit ? 'Category updated.' : 'Category added.')
      onSaved()
      onClose()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={isEdit ? 'Edit Category' : 'Add New Category'} onClose={onClose} wide>
    <form className="adm-product-form" onSubmit={submit}>
      <div className="adm-form-section">
        <div className="adm-form-section-head"><Tags size={16} /><h3>Category Information</h3></div>
        <p className="adm-form-section-description">Add the basic information for this product category.</p>
        <div className="adm-soft-section">
          <div className="adm-form-grid">
            <label className="field field-wide"><span>Category name</span><input required value={form.name} onChange={(event) => setField('name', event.target.value)} onBlur={() => setField('name', capitalizeFirst(form.name))} placeholder="e.g. Vegetables" /></label>
            <label className="field field-wide"><span>Description</span><textarea rows="4" value={form.description} onChange={(event) => setField('description', event.target.value)} placeholder="Add a short description for this category…" /></label>
          </div>
        </div>
      </div>

      <div className="adm-form-section">
        <div className="adm-form-section-head"><ImageIcon size={16} /><h3>Category Image</h3></div>
        <p className="adm-form-section-description">Upload an image to represent this category.</p>
        <div className="adm-soft-section">
          <div className="adm-image-upload">
            <div className="adm-image-preview">{imagePreview ? <img src={imagePreview} alt="Category preview" /> : <span><ImageIcon size={26} />Upload Category Image</span>}</div>
            <div className="adm-image-actions">
              <button type="button" className="button button-outline" onClick={() => fileInputRef.current?.click()}><Upload size={15} />{imagePreview ? 'Replace Image' : 'Upload Image'}</button>
              {imagePreview && <button type="button" className="text-link" onClick={() => setImagePreview('')}>Remove image</button>}
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onImageSelected} />
              <p className="adm-image-hint">Click to upload. JPG, JPEG, PNG or WEBP, up to 5MB.</p>
              {imageError && <div className="form-error">{imageError}</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="adm-form-section">
        <div className="adm-form-section-head"><Settings size={16} /><h3>Category Settings</h3></div>
        <p className="adm-form-section-description">Control the visibility and display order of this category.</p>
        <div className="adm-soft-section">
          <div className="adm-option-row">
            <div className="adm-option-copy"><strong>Category status</strong><p>Active categories are visible to customers.</p></div>
            <div className="adm-switch-field">
              <span className="adm-switch-state">{form.active ? 'Active' : 'Inactive'}</span>
              <button type="button" role="switch" aria-checked={form.active} aria-label="Category status" className={`adm-switch${form.active ? ' is-on' : ''}`} onClick={() => setField('active', !form.active)}><span className="adm-switch-thumb" /></button>
            </div>
          </div>

          <label className="field"><span>Display order</span><input type="number" min="0" step="1" value={form.displayOrder} onChange={(event) => setField('displayOrder', event.target.value)} placeholder="e.g. 1" /><small className="adm-field-hint">Lower numbers appear first.</small></label>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      <div className="adm-modal-foot">
        <button type="button" className="button button-outline" onClick={onClose}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Category'}<Save size={15} /></button>
      </div>
    </form>
  </Modal>
}
