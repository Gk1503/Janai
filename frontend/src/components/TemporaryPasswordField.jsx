import { useState } from 'react'
import { Eye, EyeOff, Wand2 } from 'lucide-react'
import { Field } from './Forms'
import { generateTemporaryPassword } from '../utils/tempPassword'

export default function TemporaryPasswordField({ value, onChange, error, label = 'Temporary password' }) {
  const [visible, setVisible] = useState(false)
  return <Field label={label} required error={error} hint="At least 10 characters with a letter and a number. You will give this to the staff member; they must change it at first sign-in.">
    <span className="adm-password-row">
      <input type={visible ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button" className="adm-icon-button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      <button type="button" className="button button-outline" onClick={() => { onChange(generateTemporaryPassword()); setVisible(true) }}><Wand2 size={15} />Generate</button>
    </span>
  </Field>
}
