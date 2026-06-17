const $ = (sel) => document.querySelector(sel)
const api = (url, opts) => fetch(url, opts).then(r => r.ok ? r.json() : Promise.reject(r))

let config = null
let currentMode = ''

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
  renderLampTable()
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

function renderLampTable() {
  const tbody = $('#lamp-table tbody')
  tbody.innerHTML = ''
  for (const l of (config.lamps || [])) addLampRow(l)
  renderManualControls()
}

function addLampRow(l = { id: '', atemInput: '', previewPin: '', activePin: '' }) {
  const tr = document.createElement('tr')
  for (const f of ['id', 'atemInput', 'previewPin', 'activePin']) {
    const td = document.createElement('td')
    const inp = document.createElement('input')
    inp.type = 'number'; inp.dataset.field = f; inp.value = l[f]
    td.appendChild(inp); tr.appendChild(td)
  }
  const tdAct = document.createElement('td')
  const del = document.createElement('button')
  del.type = 'button'; del.textContent = '×'
  del.onclick = () => tr.remove()
  tdAct.appendChild(del)
  const testProg = document.createElement('button')
  testProg.type = 'button'; testProg.textContent = 'Тест P'; testProg.className = 'btn-test'
  testProg.onclick = () => api('/api/test/lamp/' + l.id + '?color=program', { method: 'POST' }).catch(() => {})
  tdAct.appendChild(testProg)
  const testPrev = document.createElement('button')
  testPrev.type = 'button'; testPrev.textContent = 'Тест V'; testPrev.className = 'btn-test'
  testPrev.onclick = () => api('/api/test/lamp/' + l.id + '?color=preview', { method: 'POST' }).catch(() => {})
  tdAct.appendChild(testPrev)
  tr.appendChild(tdAct)
  $('#lamp-table tbody').appendChild(tr)
}

function collectConfig() {
  const lamps = [...document.querySelectorAll('#lamp-table tbody tr')].map(tr => {
    const o = {}
    tr.querySelectorAll('input').forEach(i => { o[i.dataset.field] = Number(i.value) })
    return o
  })
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
}

function connectEvents() {
  const es = new EventSource('/events')
  es.onmessage = (e) => {
    const data = JSON.parse(e.data)
    if (data.mode) setMode(data.mode)
    if (data.lamps) renderLamps(data.lamps)
    if (data.connections) setStatus(data.connections)
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
    li.textContent = a.ip + (a.model ? ` (${a.model})` : '')
    const pick = document.createElement('button')
    pick.textContent = 'выбрать'; pick.onclick = () => { $('#atemIp').value = a.ip }
    li.appendChild(pick); list.appendChild(li)
  }
  if (!found.length) list.innerHTML = '<li>не найдено</li>'
}
$('#add-lamp').onclick = () => addLampRow()
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
