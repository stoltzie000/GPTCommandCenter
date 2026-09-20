import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import test from 'node:test';

const require=createRequire(import.meta.url);
let playwright:any;
try{playwright=require('playwright');}catch{playwright=undefined;}
const browserAvailable=!!playwright&&existsSync(playwright.chromium.executablePath());
const required=process.env.REQUIRE_BROWSER_CERTIFICATION==='1';

const repositories=JSON.stringify({
  'task29-multi':{source:process.cwd(),classification:'PUBLIC',allowedCallers:['local-development'],allowedExecutionTypes:['specialist']},
  'task29-software':{source:process.cwd(),classification:'PUBLIC',allowedCallers:['local-development'],allowedSpecialists:['architecture-security-advisor'],allowedExecutionTypes:['specialist','codex','validation']}
});

async function startServer(){
  const port=19000+Math.floor(Math.random()*500);
  const child=spawn(process.execPath,['dist/src/server.js'],{cwd:process.cwd(),env:{...process.env,APP_MODE:'local',AUTH_MODE:'disabled',PORT:String(port),ALLOWED_REPOSITORIES:repositories,AUTH_PRINCIPALS:'{}',SPECIALIST_INVENTORY_PROVIDER:'none',ARCHITECTURE_SECURITY_CHATGPT_URL:'https://chatgpt.com/g/g-task29-security'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',chunk=>{logs+=String(chunk).slice(-4000);});child.stderr.on('data',chunk=>{logs+=String(chunk).slice(-4000);});
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){try{const response=await fetch(`http://127.0.0.1:${port}/ready`);if(response.status===200)return {child,port,logs:()=>logs};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  child.kill('SIGTERM');throw new Error(`TASK29_SERVER_START_TIMEOUT ${logs}`);
}
async function waitForText(page:any,pattern:RegExp){await page.waitForFunction((source:string)=>new RegExp(source).test(document.querySelector('#workflow-panel')?.textContent??''),pattern.source,{timeout:10000});}
async function waitForSelector(page:any,selector:string){try{await page.locator(selector).waitFor();}catch(error){throw new Error(`${error instanceof Error?error.message:error} UI=${await page.locator('#workflow-panel').textContent()}`);}}
async function submit(page:any,repository:string,objective:string,type:'software'|'non_code',implementation=false,serverLogs=()=> ''){await page.locator('#repository').fill(repository);await page.locator('#objective').fill(objective);await page.locator('#workflow-type').selectOption(type);const checkbox=page.locator('#requires-implementation');if(implementation)await checkbox.check();await page.locator('#task-form button[type="submit"]').click();try{await page.locator('#workflow-panel').waitFor();}catch(error){throw new Error(`${error instanceof Error?error.message:error} intake=${await page.locator('#intake-error').textContent()} server=${serverLogs()}`);}}

if(!playwright||!browserAvailable){
  if(required)test('mandatory live client/backend certification requires Playwright and Chromium',()=>{throw new Error('LIVE_CLIENT_CERTIFICATION_REQUIRES_BROWSER');});
  else test('Task 29 live client/backend certification requires Playwright and Chromium',{skip:'Playwright or Chromium is unavailable in this environment'},()=>{});
}else{
  test('real Chromium client drives the real GPTCC server through manual return and Codex handoff boundary',async()=>{
    const {child,port,logs}=await startServer();const context=await playwright.chromium.launch({headless:true});
    try{
      const browserContext=await context.newContext();await browserContext.grantPermissions(['clipboard-read','clipboard-write'],{origin:`http://127.0.0.1:${port}`});await browserContext.addInitScript(() => { Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as unknown as {__task29Copied?:string}).__task29Copied=value;}}}); });const page=await browserContext.newPage();page.on('console',(message:any)=>{if(message.type()==='error')console.error(`browser-console: ${message.text()}`);});page.on('response',async(response:any)=>{if(response.status()>=400)console.error(`browser-response: ${response.status()} ${response.url()} ${await response.text().catch(()=> '')}`);});await page.goto(`http://127.0.0.1:${port}/`);
      await submit(page,'task29-multi','Review architecture, security, and repository configuration','non_code',false,logs);await page.locator('#next-actions button').click();await waitForSelector(page,'.stage-handoff');
      const initial=await page.locator('#workflow-panel').textContent();assert.match(initial,/Orchestration plan/);assert.match(initial,/Architecture & Security Advisor/);const link=page.locator('.stage-handoff a');assert.equal(await link.getAttribute('target'),'_blank');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');await page.locator('.stage-handoff button',{hasText:'Copy stage handoff context'}).click();assert.equal(await page.locator('.stage-handoff button',{hasText:'Copied'}).count(),1);await page.locator('.stage-handoff textarea').fill('{"summary":"manual repository review"}');await page.locator('.stage-handoff button',{hasText:'Submit stage output'}).click();await waitForText(page,/Executing|SPECIALIST_RUNNING/);assert.match(await page.locator('#workflow-panel').textContent(),/manual_specialist_output|Externally supplied|Executing/);await page.locator('#next-actions button').click();await page.locator('.stage-handoff').waitFor();assert.match(await page.locator('#workflow-panel').textContent(),/no safe return path|Do not submit output/);assert.equal(await page.locator('.stage-handoff textarea').count(),0);
      await page.goto(`http://127.0.0.1:${port}/`);await submit(page,'task29-software','Review the architecture and security of this repository','software',true,logs);await page.locator('#next-actions button').click();await waitForSelector(page,'#handoff textarea');assert.match(await page.locator('#workflow-panel').textContent(),/Architecture & Security Advisor/);const softwareOutput=JSON.stringify({objective:'Review the architecture and security of this repository',requirements:['preserve authorization'],constraints:[],affected_components:['workflow'],security_requirements:['retain provenance'],test_requirements:['run validation'],acceptance_criteria:['safe handoff'],validation_required:false,validation_reason:''});await page.locator('#handoff textarea').fill(softwareOutput);await page.locator('#handoff button',{hasText:'Submit external specialist output'}).click();await waitForText(page,/Specialist complete/);await page.locator('#next-actions button').click();await waitForText(page,/Codex ready/);assert.match(await page.locator('#workflow-panel').textContent(),/Codex ready/);await page.locator('#next-actions button').click();await waitForText(page,/Failed/);const final=await page.locator('#workflow-panel').textContent();assert.match(final,/Failed/);assert.match(final,/codex_prompt/);assert.match(final,/Externally supplied/);
    }finally{await context.close();child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  });
}
