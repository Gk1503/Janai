import { PERMISSION_GROUPS, REQUIRES, withPrerequisites, withoutDependents } from '../utils/permissions'

const LABELS = Object.fromEntries(PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => [item.permission, item.label])))

// Permissions grouped by module. Ticking an action also ticks what it needs; unticking a "view"
// permission removes the actions that depend on it, so the saved list always satisfies the backend rules.
export default function PermissionGrid({ value, onChange, disabled = false }) {
  const selected = new Set(value)
  function toggle(permission, checked) {
    onChange(checked ? withPrerequisites([...value, permission]) : withoutDependents(value, permission))
  }

  return <div className="adm-perm-grid">
    {PERMISSION_GROUPS.map((group) => <fieldset className="adm-perm-group" key={group.key} disabled={disabled}>
      <legend>{group.label}{group.available === false && <em className="adm-perm-note">Module not available yet — no effect for now</em>}</legend>
      {group.items.map((item) => {
        const needs = (REQUIRES[item.permission] || []).map((required) => LABELS[required]).filter(Boolean)
        return <label className="adm-perm-item" key={item.permission}>
          <input type="checkbox" checked={selected.has(item.permission)} onChange={(event) => toggle(item.permission, event.target.checked)} />
          <span>
            <strong>{item.label}</strong>
            <small><code>{item.permission}</code>{needs.length > 0 && <> · requires “{needs.join('”, “')}”</>}</small>
          </span>
        </label>
      })}
    </fieldset>)}
  </div>
}
