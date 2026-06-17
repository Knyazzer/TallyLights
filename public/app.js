const $ = (sel) => document.querySelector(sel)
const api = (url, opts) => fetch(url, opts).then(r => r.ok ? r.json() : Promise.reject(r))

let config = null
let currentMode = ''
let atemInputs = []
let atemWasConnected = false

function manualTallyPath(atemInput, state) {
  return '/' + state + '/' + atemInput
}

async function loadConfig() {
  config = await api('/api/config')
  $('#baudRate').value = config.baudRate ?? 57600
  $('#atemIp').value = config.atem?.ip ?? ''
  $('#httpPort').value = config.http?.port ?? 8080
  $('#defaultMode').value = config.defaultMode ?? 'atem'
  $('#onAtemDisconnect').value = config.onAtemDisconnect ?? 'hold'
  await loadPorts()
  await loadAtemInputs()
  renderLampMap()
  renderManualControls()
  renderLampTests()
}

async function loadPorts() {
  const ports = await api('/api/ports')
  const sel = $('#comPort')
  sel.innerHTML = ''
  for (const p of ports) {
    const o = document.createElement('option')
    o.value = p.path; o.textContent = p.path
    sel.appendChild(o)
  }
  if (config.comPort) sel.value = config.comPort
}

async function loadAtemInputs() {
  try { atemInputs = await api('/api/atem/inputs') } catch { atemInputs = [] }
}

// Re-fetch ATEM inputs and refresh the dropdown options in place, keeping each
// lamp's current selection. Called when the ATEM connects (inputs become known).
async function refreshInputOptions() {
  await loadAtemInputs()
  document.querySelectorAll('#lamp-table tbody tr').forEach(tr => {
    const sel = tr.querySelector('select.atem-input')
    if (!sel) return
    const current = sel.value
    sel.innerHTML = buildInputSelect(Number(current)).innerHTML
    sel.value = current
  })
}

// ── Lamp map: fixed lamps (pins are hardcoded in the server), only the ATEM
// input is editable, chosen from a dropdown of the real switcher inputs. ──────
function buildInputSelect(selected) {
  const sel = document.createElement('select')
  sel.className = 'atem-input'
  const list = atemInputs.length ? atemInputs : [{ id: selected, name: 'вход ' + selected }]
  let matched = false
  for (const inp of list) {
    const o = document.createElement('option')
    o.value = inp.id; o.textContent = inp.id + ' — ' + inp.name
    if (Number(inp.id) === Number(selected)) { o.selected = true; matched = true }
    sel.appendChild(o)
  }
  // Keep the saved value selectable even if the ATEM didn't report it (offline).
  if (!matched && selected != null && selected !== '') {
    const o = document.createElement('option')
    o.value = selected; o.textContent = selected + ' — (текущий)'; o.selected = true
    sel.appendChild(o)
  }
  return sel
}

function renderLampMap() {
  const tbody = $('#lamp-table tbody')
  tbody.innerHTML = ''
  for (const l of (config.lamps || [])) {
    const tr = document.createElement('tr')
    tr.dataset.id = l.id
    const tdId = document.createElement('td')
    tdId.textContent = l.id
    tr.appendChild(tdId)
    const tdSel = document.createElement('td')
    tdSel.appendChild(buildInputSelect(l.atemInput))
    tr.appendChild(tdSel)
    tbody.appendChild(tr)
  }
}

function collectConfig() {
  const lamps = [...document.querySelectorAll('#lamp-table tbody tr')].map(tr => ({
    id: Number(tr.dataset.id),
    atemInput: Number(tr.querySelector('select.atem-input').value)
  }))
  return {
    comPort: $('#comPort').value,
    baudRate: Number($('#baudRate').value),
    atem: { ip: $('#atemIp').value, enabled: true },
    http: { port: Number($('#httpPort').value), enabled: true },
    defaultMode: $('#defaultMode').value,
    onAtemDisconnect: $('#onAtemDisconnect').value,
    lamps
  }
}

function renderLamps(lamps) {
  const box = $('#lamps')
  box.innerHTML = ''
  for (const l of lamps) {
    const d = document.createElement('div')
    d.className = 'lamp' + (l.program ? ' program' : l.preview ? ' preview' : '')
    d.textContent = l.id
    box.appendChild(d)
  }
}

// ── Lamp test: momentary pulse, works in any mode (for checking wiring). ──────
function renderLampTests() {
  const box = document.querySelector('#lamp-tests .test-list')
  if (!box) return
  box.innerHTML = ''
  for (const l of (config.lamps || [])) {
    const row = document.createElement('div')
    row.className = 'manual-row'
    const label = document.createElement('span')
    label.textContent = 'Лампа ' + l.id
    row.appendChild(label)
    for (const [color, text] of [['program', 'Тест P'], ['preview', 'Тест V']]) {
      const btn = document.createElement('button')
      btn.type = 'button'; btn.textContent = text; btn.className = 'btn-test'
      btn.onclick = () => api('/api/test/lamp/' + l.id + '?color=' + color, { method: 'POST' }).catch(() => {})
      row.appendChild(btn)
    }
    box.appendChild(row)
  }
}

function renderManualControls() {
  const section = $('#manual-controls')
  if (!section) return
  const list = section.querySelector('.manual-list')
  list.innerHTML = ''
  for (const l of (config.lamps || [])) {
    const row = document.createElement('div')
    row.className = 'manual-row'
    const label = document.createElement('span')
    label.textContent = 'Лампа ' + l.id + ' (вход ' + l.atemInput + ')'
    row.appendChild(label)
    for (const [state, text] of [['program', 'Program'], ['preview', 'Preview'], ['off', 'Off']]) {
      const btn = document.createElement('button')
      btn.type = 'button'; btn.textContent = text; btn.className = 'btn-manual'
      btn.dataset.state = state; btn.dataset.input = l.atemInput
      btn.onclick = () => api(manualTallyPath(l.atemInput, state), { method: 'POST' }).catch(() => {})
      row.appendChild(btn)
    }
    list.appendChild(row)
  }
  updateManualButtonsState()
}

function updateManualButtonsState() {
  const isManual = currentMode === 'manual'
  document.querySelectorAll('.btn-manual').forEach(b => {
    b.disabled = !isManual
    b.classList.toggle('disabled', !isManual)
  })
  const clearBtn = $('#manual-clear')
  if (clearBtn) { clearBtn.disabled = !isManual; clearBtn.classList.toggle('disabled', !isManual) }
}

function setMode(mode) {
  currentMode = mode
  $('#mode-current').textContent = mode
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode))
  updateManualButtonsState()
}

function setStatus(conn) {
  $('#st-atem').classList.toggle('on', !!conn?.atem)
  $('#st-com').classList.toggle('on', !!conn?.com)
  const nameEl = $('#atem-name')
  if (nameEl) nameEl.textContent = conn?.atem ? (conn.atemName || '') : ''
}

function connectEvents() {
  const es = new EventSource('/events')
  es.onmessage = (e) => {
    const data = JSON.parse(e.data)
    if (data.mode) setMode(data.mode)
    if (data.lamps) renderLamps(data.lamps)
    if (data.connections) {
      setStatus(data.connections)
      const nowConnected = !!data.connections.atem
      if (nowConnected && !atemWasConnected) refreshInputOptions()
      atemWasConnected = nowConnected
    }
  }
}

document.querySelectorAll('.mode-btn').forEach(b => {
  b.onclick = () => api('/mode/' + b.dataset.mode, { method: 'POST' })
})
$('#scan').onclick = async () => {
  const list = $('#atem-list'); list.innerHTML = '<li>сканирование…</li>'
  const found = await api('/api/atem/scan')
  list.innerHTML = ''
  for (const a of found) {
    const li = document.createElement('li')
    li.textContent = a.ip + (a.name ? ` — ${a.name}` : '')
    const pick = document.createElement('button')
    pick.textContent = 'выбрать'; pick.onclick = () => { $('#atemIp').value = a.ip }
    li.appendChild(pick); list.appendChild(li)
  }
  if (!found.length) list.innerHTML = '<li>не найдено</li>'
}
$('#settings').onsubmit = async (e) => {
  e.preventDefault()
  try {
    const res = await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectConfig()) })
    if (res && res.restartRequired) alert('Сохранено. Перезапустите сервер для применения: ' + (res.restartFields || []).join(', '))
    else alert('Сохранено и применено')
  }
  catch { alert('Ошибка валидации конфига') }
}

$('#manual-clear').onclick = () => api('/clear', { method: 'POST' }).catch(() => {})

loadConfig().then(connectEvents)
