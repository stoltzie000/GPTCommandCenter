const state = { workflowId: null, token: '', timer: null, workflow: null };
const $ = (id) => document.getElementById(id);
const terminal = new Set(['COMPLETE', 'FAILED', 'MANUAL_HANDOFF_REQUIRED']);
const labels = {
  ROUTED: 'Routed', EXECUTING: 'Executing', SPECIALIST_RUNNING: 'Executing',
  SPECIALIST_COMPLETE: 'Specialist complete', CODEX_PROMPT_READY: 'Codex ready',
  CODEX_RUNNING: 'Codex executing', VALIDATING: 'Validating', COMPLETE: 'Complete',
  FAILED: 'Failed', AWAITING_CLARIFICATION: 'Awaiting clarification',
  AWAITING_APPROVAL: 'Awaiting approval', MANUAL_HANDOFF_REQUIRED: 'Manual handoff required'
};
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function setHidden(el, hidden) { el.hidden = hidden; }
function showError(id, message) { const el = $(id); el.textContent = message; el.hidden = !message; }
function apiHeaders() { const headers = { 'content-type': 'application/json' }; if (state.token) headers.authorization = `Bearer ${state.token}`; return headers; }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...apiHeaders(), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || `Request failed (${response.status})`); error.status = response.status; throw error; }
  return body;
}
function statusClass(status) { return `status status-${String(status || '').toLowerCase()}`; }
function addDefinition(parent, term, value) { const row = node('div', undefined, 'definition'); row.append(node('dt', term), node('dd', value)); parent.append(row); }
function renderSummary(workflow) {
  const summary = $('workflow-summary'); summary.replaceChildren();
  const dl = node('dl', undefined, 'summary-grid');
  addDefinition(dl, 'Status', labels[workflow.status] || workflow.status);
  addDefinition(dl, 'Workflow ID', workflow.id);
  addDefinition(dl, 'Objective', workflow.objective);
  addDefinition(dl, 'Routing confidence', workflow.routingConfidence || 'Not reported');
  addDefinition(dl, 'Specialist', workflow.selectedSpecialistId || 'Pending routing');
  addDefinition(dl, 'Runtime', workflow.runtime?.executable ? 'Approved executable runtime' : (workflow.runtime?.status || 'Not available'));
  const badge = node('span', labels[workflow.status] || workflow.status, statusClass(workflow.status));
  $('workflow-title').textContent = `Workflow ${workflow.id}`; $('workflow-title').append(' ', badge); summary.append(dl);
}
async function renderSpecialist(workflow) {
  if (!workflow.selectedSpecialistId) return;
  try { const specialist = await api(`/v1/specialists/${encodeURIComponent(workflow.selectedSpecialistId)}`); const summary = $('workflow-summary'); const dl = summary.querySelector('dl'); if (!dl) return; addDefinition(dl, 'Specialist origin', `${specialist.origin}: ${specialist.displayName}`); addDefinition(dl, 'Automatic execution', specialist.runtime?.executable ? 'Available' : (specialist.manualHandoff?.available ? 'Manual handoff' : 'Unavailable')); } catch { /* specialist details are supplemental */ }
}
function renderActions(workflow) {
  const actions = $('next-actions'); actions.replaceChildren();
  const canRun = ['ROUTED', 'SPECIALIST_RUNNING', 'SPECIALIST_COMPLETE', 'CODEX_PROMPT_READY'].includes(workflow.status);
  if (canRun) { const button = node('button', workflow.status === 'ROUTED' ? 'Run specialist' : 'Continue workflow'); button.onclick = () => runWorkflow(); actions.append(button); }
  if (workflow.status === 'FAILED') { const button = node('button', 'Request recovery', 'secondary'); button.onclick = () => recoverWorkflow(); actions.append(button); }
  if (!actions.children.length && !terminal.has(workflow.status)) actions.append(node('p', 'The backend is processing this workflow. This page will refresh automatically.', 'muted'));
}
function handoffValue(value, expectedOutput) {
  if (!expectedOutput?.startsWith('SoftwareOutput JSON:')) return value;
  try { return JSON.parse(value); } catch { throw new Error('Software handoff output must be valid JSON.'); }
}
function renderStageHandoff(workflow, stage, parent) {
  const handoff = stage.manualHandoff; if (!handoff) return;
  const box = node('div', undefined, 'stage-handoff'); box.append(node('strong', `Manual handoff for ${stage.id}`), node('p', handoff.available ? `GPTCC selected ${handoff.specialistName}; automatic execution is unavailable.` : 'This stage requires manual intervention, but no safe return path is available.'));
  if (!handoff.available) { box.append(node('p', 'Do not submit output through this client for this stage.', 'warning')); parent.append(box); return; }
  if (handoff.navigationUrl) { const link = node('a', `Open ${handoff.specialistName} in ChatGPT`); link.href = handoff.navigationUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link); }
  const packageText = JSON.stringify({ workflowId: workflow.id, planId: workflow.orchestrationPlan.plan.id, planVersion: workflow.orchestrationPlan.plan.version, stageId: stage.id, specialistId: stage.specialistId, purpose: stage.purpose, expectedOutput: handoff.expectedOutput, instructions: handoff.instructions }, null, 2);
  const copy = node('button', 'Copy stage handoff context', 'secondary'); copy.onclick = async () => { try { await navigator.clipboard.writeText(packageText); copy.textContent = 'Copied'; } catch { showError('workflow-error', 'Clipboard access was unavailable; copy the displayed context manually.'); } };
  const pre = node('pre', packageText, 'handoff-package'); box.append(pre, copy);
  const form = node('form', undefined, 'inline-form'); const output = node('textarea'); output.required = true; output.maxLength = 100000; output.rows = 7; output.placeholder = 'Paste the selected specialist output here'; const submit = node('button', 'Submit stage output'); form.append(output, submit); form.onsubmit = async (event) => { event.preventDefault(); submit.disabled = true; try { await api(handoff.returnEndpoint, { method: 'POST', body: JSON.stringify({ output: handoffValue(output.value, handoff.expectedOutput) }) }); await refresh(); } catch (error) { showError('workflow-error', error.message); submit.disabled = false; } }; box.append(node('p', 'Submitted output is externally supplied and is not represented as authenticated provider execution.'), form); parent.append(box);
}
async function renderPlan(workflow) {
  const section = $('plan'); section.replaceChildren(); setHidden(section, !workflow.orchestrationPlan); if (!workflow.orchestrationPlan) return;
  section.append(node('h3', 'Orchestration plan'));
  const stages = node('ol', undefined, 'stage-list');
  for (const stage of workflow.orchestrationPlan.stages || []) {
    const item = node('li'); item.append(node('strong', `${stage.stageId}: ${stage.purpose || stage.stageType || 'Stage'}`));
    item.append(node('span', `Specialist: ${stage.specialistId || 'platform stage'} · ${stage.status || 'pending'}`, 'muted'));
    if (stage.dependencies?.length) item.append(node('span', `After: ${stage.dependencies.join(', ')}`, 'muted'));
    renderStageHandoff(workflow, stage, item);
    stages.append(item);
  }
  section.append(stages);
}
async function renderClarification(workflow) {
  const section = $('clarification'); section.replaceChildren(); setHidden(section, !workflow.clarificationRequired); if (!workflow.clarificationRequired) return;
  try { const clarification = await api(`/v1/workflows/${encodeURIComponent(workflow.id)}/clarification`); section.append(node('h3', 'Clarification needed'), node('p', clarification.question || clarification.prompt || 'Please clarify the request.'));
    const form = node('form', undefined, 'inline-form'); const input = node('textarea'); input.required = true; input.rows = 3; input.placeholder = 'Your clarification'; const button = node('button', 'Submit clarification'); form.append(input, button); form.onsubmit = async (event) => { event.preventDefault(); button.disabled = true; try { await api(`/v1/workflows/${encodeURIComponent(workflow.id)}/clarification-response`, { method: 'POST', body: JSON.stringify({ clarificationId: clarification.id, response: input.value }) }); await refresh(); } catch (error) { showError('workflow-error', error.message); button.disabled = false; } }; section.append(form);
  } catch (error) { section.append(node('p', `Clarification is required, but it could not be loaded: ${error.message}`, 'error')); }
}
async function renderApproval(workflow) {
  const section = $('approval'); section.replaceChildren(); setHidden(section, !workflow.approvalRequired); if (!workflow.approvalRequired) return;
  try { const approval = await api(`/v1/workflows/${encodeURIComponent(workflow.id)}/approval`); section.append(node('h3', 'Approval required'), node('p', approval.reason || approval.description || 'Review the requested action.'));
    const form = node('form', undefined, 'inline-form'); const reason = node('input'); reason.placeholder = 'Optional reason'; const approve = node('button', 'Approve'); const reject = node('button', 'Reject', 'danger'); form.append(reason, approve, reject); const decide = async (decision) => { approve.disabled = reject.disabled = true; try { await api(`/v1/workflows/${encodeURIComponent(workflow.id)}/approval`, { method: 'POST', body: JSON.stringify({ approvalId: approval.id, decision, reason: reason.value }) }); await refresh(); } catch (error) { showError('workflow-error', error.message); approve.disabled = reject.disabled = false; } }; approve.onclick = (event) => { event.preventDefault(); void decide('APPROVED'); }; reject.onclick = (event) => { event.preventDefault(); void decide('REJECTED'); }; section.append(form);
  } catch (error) { section.append(node('p', `Approval is required, but it could not be loaded: ${error.message}`, 'error')); }
}
async function renderHandoff(workflow) {
  const section = $('handoff'); section.replaceChildren(); setHidden(section, workflow.status !== 'MANUAL_HANDOFF_REQUIRED' || !!workflow.orchestrationPlan); if (workflow.status !== 'MANUAL_HANDOFF_REQUIRED' || workflow.orchestrationPlan) return;
  try { const handoff = await api(`/v1/workflows/${encodeURIComponent(workflow.id)}/handoff`); section.append(node('h3', 'Manual specialist handoff'));
    if (!handoff.available) { section.append(node('p', 'This workflow needs manual intervention. Stage-level return is not supported for this orchestration plan; no unsafe submission form is shown.', 'warning')); return; }
    section.append(node('p', 'GPTCC selected this specialist, but did not execute it automatically. Opening the link does not transfer data or return output automatically.'));
    if (handoff.navigationUrl) { const link = node('a', 'Open configured ChatGPT GPT'); link.href = handoff.navigationUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; section.append(link); }
    const packageText = JSON.stringify({ workflowId: workflow.id, specialistId: handoff.specialistId, task: handoff.task, expectedOutput: handoff.expectedOutput, instructions: handoff.instructions }, null, 2);
    const pre = node('pre', packageText, 'handoff-package'); const copy = node('button', 'Copy handoff context', 'secondary'); copy.onclick = async () => { try { await navigator.clipboard.writeText(packageText); copy.textContent = 'Copied'; } catch { showError('workflow-error', 'Clipboard access was unavailable; copy the displayed package manually.'); } }; section.append(pre, copy);
    if (handoff.returnEndpoint) { const form = node('form', undefined, 'inline-form'); const output = node('textarea'); output.required = true; output.maxLength = 100000; output.rows = 8; output.placeholder = 'Paste the specialist output here'; const submit = node('button', 'Submit external specialist output'); form.append(output, submit); form.onsubmit = async (event) => { event.preventDefault(); submit.disabled = true; try { await api(handoff.returnEndpoint, { method: 'POST', body: JSON.stringify({ output: handoffValue(output.value, handoff.expectedOutput) }) }); await refresh(); } catch (error) { showError('workflow-error', error.message); submit.disabled = false; } }; section.append(node('p', 'Submitted output is recorded as externally supplied and is not represented as authenticated provider execution.'), form); }
  } catch (error) { section.append(node('p', `Manual handoff details could not be loaded: ${error.message}`, 'error')); }
}
async function renderResult(workflow) {
  const section = $('result'); section.replaceChildren(); setHidden(section, !terminal.has(workflow.status)); if (!terminal.has(workflow.status)) return;
  try { const result = await api(`/v1/workflows/${encodeURIComponent(workflow.id)}/result`); section.append(node('h3', workflow.status === 'COMPLETE' ? 'Result' : 'Outcome'));
    for (const artifact of result.artifacts || []) { const card = node('article', undefined, 'artifact'); card.append(node('strong', artifact.type || artifact.artifactType || 'Artifact'), node('span', artifact.source === 'user_submitted' || artifact.artifactType === 'manual_specialist_output' ? 'Externally supplied' : 'Platform evidence', 'muted')); const content = artifact.content ?? artifact.contentJson; const pre = node('pre', typeof content === 'string' ? content : JSON.stringify(content, null, 2)); card.append(pre); section.append(card); }
  } catch (error) { section.append(node('p', `Result is not available yet: ${error.message}`, 'muted')); }
}
async function renderEvents(workflow) { try { const events = await api(`/v1/workflows/${encodeURIComponent(workflow.id)}/events`); const target = $('events'); target.replaceChildren(); for (const event of events || []) { const row = node('div', undefined, 'event'); row.append(node('time', event.occurredAt || event.createdAt || ''), node('span', event.type || event.eventType || 'event')); target.append(row); } } catch { /* timeline is supplemental */ } }
async function refresh() {
  if (!state.workflowId) return;
  try { const workflow = await api(`/v1/workflows/${encodeURIComponent(state.workflowId)}`); state.workflow = workflow; renderSummary(workflow); renderActions(workflow); await renderPlan(workflow); await Promise.all([renderSpecialist(workflow), renderClarification(workflow), renderApproval(workflow), renderHandoff(workflow), renderResult(workflow), renderEvents(workflow)]); showError('workflow-error', ''); if (terminal.has(workflow.status) && state.timer) { clearInterval(state.timer); state.timer = null; } } catch (error) { showError('workflow-error', `Could not load workflow: ${error.message}`); }
}
async function runWorkflow() { try { await api(`/v1/workflows/${encodeURIComponent(state.workflowId)}/run`, { method: 'POST', body: '{}' }); await refresh(); } catch (error) { showError('workflow-error', error.message); } }
async function recoverWorkflow() { try { await api(`/v1/workflows/${encodeURIComponent(state.workflowId)}/recover`, { method: 'POST', body: JSON.stringify({ reason: 'User requested recovery review' }) }); await refresh(); } catch (error) { showError('workflow-error', error.message); } }
async function createWorkflow(event) { event.preventDefault(); showError('intake-error', ''); const button = event.submitter; button.disabled = true; state.token = $('session-token').value.trim(); try { const workflow = await api('/v1/workflows', { method: 'POST', body: JSON.stringify({ request_id: crypto.randomUUID(), objective: $('objective').value.trim(), workflow_type: $('workflow-type').value, requires_implementation: $('requires-implementation').checked, repository: $('repository').value.trim() }) }); state.workflowId = workflow.id; $('intake').hidden = true; $('workflow-panel').hidden = false; await refresh(); if (state.workflow && !terminal.has(state.workflow.status)) state.timer = setInterval(refresh, 2500); } catch (error) { showError('intake-error', error.status === 401 ? 'Authentication is required. Enter a deployment session token or use the documented local mode.' : error.message); button.disabled = false; } }
$('task-form').onsubmit = createWorkflow; $('new-workflow').onclick = () => { if (state.timer) clearInterval(state.timer); state.workflowId = null; state.workflow = null; $('workflow-panel').hidden = true; $('intake').hidden = false; $('task-form').reset(); $('intake-error').hidden = true; };
