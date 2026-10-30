'use strict';
const path=require('node:path');
const entry=process.argv[1]||'';
if(!/[\\/]playwright[\\/](cli\.js|lib[\\/]worker[\\/]workerProcessEntry\.js)$/.test(entry))return;
const fs=require('node:fs');
if(!process.env.DIAGNOSTIC_SOURCE_ROOT)throw new Error('DIAGNOSTIC_SOURCE_ROOT is required');
const sourceRoot=fs.realpathSync(process.env.DIAGNOSTIC_SOURCE_ROOT);
const canaryOverride=Boolean(process.env.DIAGNOSTIC_CANARY_SCOPE_ROOT);
if(canaryOverride&&(process.env.CI||process.env.GITHUB_ACTIONS))throw new Error('Canary scope override is forbidden in hosted/CI diagnostics');
const scopeRoot=canaryOverride?fs.realpathSync(process.env.DIAGNOSTIC_CANARY_SCOPE_ROOT):sourceRoot;
const testPackage=require.resolve('@playwright/test/package.json',{paths:[sourceRoot]});
const playwrightPackage=require.resolve('playwright/package.json',{paths:[path.dirname(testPackage)]});
const corePackage=require.resolve('playwright-core/package.json',{paths:[path.dirname(testPackage)]});
const packageBindings=[testPackage,playwrightPackage,corePackage].map(file=>({file:fs.realpathSync(file),name:JSON.parse(fs.readFileSync(file,'utf8')).name,version:JSON.parse(fs.readFileSync(file,'utf8')).version}));
if(packageBindings.some(x=>x.version!=='1.64.1'))throw new Error('Diagnostic observer requires exactly Playwright1.64.1 packages');
const cli=fs.realpathSync(path.join(path.dirname(playwrightPackage),'cli.js'));
const worker=fs.realpathSync(path.join(path.dirname(playwrightPackage),'lib/worker/workerProcessEntry.js'));
const canonicalEntry=fs.realpathSync(entry);
if(canonicalEntry!==cli&&canonicalEntry!==worker)throw new Error('Diagnostic observer entry is not owned by the explicit source packages');
const {chromium}=require(path.dirname(corePackage));
const {test}=require(path.dirname(testPackage));
const TARGET_FILE='tests/e2e/persistedClipEditAcceptance.spec.ts';
const TARGET_TITLE='persisted clip edits replay exact owners and source material through real same-tab hydration';
const TARGET_PROJECT='chromium-dev';
const directory=process.env.CONTROL_OBSERVER_DIR;
if(!directory)throw new Error('CONTROL_OBSERVER_DIR required for admitted Playwright process');
const MAX_RECORDS=768,MAX_BYTES=1024*1024,MAX_RECORD_BYTES=6144,MAX_STACK_BYTES=3072,MAX_CONNECTIONS=16,MAX_FILE_BYTES=MAX_BYTES+32768,MAX_PREROLL=64;
const state={pid:process.pid,ppid:process.ppid,entry:canonicalEntry,sourceRoot,scopeRoot,canaryOverride,scopeMode:canaryOverride?'canary-override':'frozen-source',packageBindings,target:{file:TARGET_FILE,title:TARGET_TITLE,project:TARGET_PROJECT},targetSeen:false,observedTarget:null,preRoll:[],preRollBytes:0,role:canonicalEntry===cli?'cli':'worker',exitObserved:false,connectionsClosed:0,limits:{MAX_RECORDS,MAX_BYTES,MAX_RECORD_BYTES,MAX_STACK_BYTES,MAX_CONNECTIONS,MAX_FILE_BYTES,MAX_PREROLL},connections:[],records:[],counts:{seen:0,filtered:0,selected:0,nonTargetIncoming:0,nonTargetAfterTarget:0,preRollEvicted:0,droppedRecords:0,droppedBytes:0,droppedConnections:0,truncated:0,errors:0,bytes:0},complete:true};
const output=path.join(directory,`control-${process.pid}.json`);
const text=(x,n=256)=>typeof x==='string'?x.slice(0,n):undefined;
function safeUrl(value){try{const u=new URL(value);return u.protocol==='http:'||u.protocol==='https:'?u.origin+u.pathname:u.protocol==='about:'?(u.protocol+u.pathname).slice(0,80):u.protocol+'[redacted]';}catch{return '[invalid-url]';}}
const outgoing=new Set(['Page.stopLoading','Page.reload','Page.navigate','Page.navigateToHistoryEntry','Page.resetNavigationHistory','Page.setWebLifecycleState','Page.handleJavaScriptDialog','Fetch.failRequest','Network.emulateNetworkConditions','Network.emulateNetworkConditionsByRule','Network.overrideNetworkState','Network.setBlockedURLs','Target.closeTarget','Target.detachFromTarget','Network.setCacheDisabled','Network.clearBrowserCache','Runtime.terminateExecution','Target.disposeBrowserContext']);
const incoming=new Set(['Network.loadingFailed','Page.lifecycleEvent','Page.domContentEventFired','Page.loadEventFired','Page.frameNavigated','Page.frameDetached','Page.frameStoppedLoading','Page.frameRequestedNavigation','Page.frameStartedNavigating','Page.frameStartedLoading','Page.javascriptDialogOpening','Page.javascriptDialogClosed','Browser.downloadWillBegin','Target.attachedToTarget','Target.detachedFromTarget','Target.targetDestroyed']);
function selected(direction,message){if(!message||typeof message.method!=='string')return false;if(direction==='receive')return incoming.has(message.method);if(direction!=='send')return false;if(outgoing.has(message.method))return true;if(message.method!=='Input.dispatchKeyEvent')return false;const p=message.params||{};return p.key==='Escape'||p.key==='F5'||p.windowsVirtualKeyCode===27||p.windowsVirtualKeyCode===116||((p.key==='r'||p.key==='R')&&((p.modifiers||0)&6)!==0);}
function parameters(method,p){
 const result={};
 for(const key of ['frameId','loaderId','targetId','sessionId','requestId','timestamp','type','reason','state','name','errorText','canceled','blockedReason','offline','errorReason','entryId','ignoreCache','key','code','windowsVirtualKeyCode','nativeVirtualKeyCode','modifiers','autoRepeat','cacheDisabled','browserContextId','navigationType','disposition','accept','result','hasBrowserHandler','guid'])if(p[key]!==undefined)result[key]=typeof p[key]==='string'?text(p[key],key==='errorText'?512:128):p[key];
 if(p.corsErrorStatus)result.corsErrorStatus={corsError:text(p.corsErrorStatus.corsError,128),failedParameter:text(p.corsErrorStatus.failedParameter,128)};
 if(p.url)result.url=safeUrl(p.url);
 if(p.frame)result.frame={id:text(p.frame.id,128),parentId:text(p.frame.parentId,128),loaderId:text(p.frame.loaderId,128),url:safeUrl(p.frame.url||'')};
 if(p.targetInfo)result.targetInfo={targetId:text(p.targetInfo.targetId,128),type:text(p.targetInfo.type,64),url:safeUrl(p.targetInfo.url||'')};
 if(method==='Network.setBlockedURLs')result.urlCount=Array.isArray(p.urls)?p.urls.length:undefined;
 if(method==='Network.emulateNetworkConditionsByRule')result.ruleCount=Array.isArray(p.matchedNetworkConditions)?p.matchedNetworkConditions.length:undefined;
 return result;
}
let cachedScopeFile,cachedCanonicalFile;
function currentScope(){
 if(state.role!=='worker')return null;
 let info;try{info=test.info();}catch{return null;}
 if(cachedScopeFile!==info.file){const canonical=fs.realpathSync(info.file);cachedScopeFile=info.file;cachedCanonicalFile=canonical;}
 return {file:text(cachedCanonicalFile,512),relativeFile:path.relative(scopeRoot,cachedCanonicalFile).split(path.sep).join('/'),scopeRoot,title:text(info.title,256),project:text(info.project.name,128)};
}
function isTarget(scope){return scope&&scope.scopeRoot===scopeRoot&&scope.relativeFile===TARGET_FILE&&scope.title===TARGET_TITLE&&scope.project===TARGET_PROJECT;}
function observe(connectionId,direction,message){
 state.counts.seen++;
 if(!selected(direction,message)){state.counts.filtered++;return;}
 const scope=currentScope(),target=isTarget(scope);
 if(!target&&direction!=='send'){state.counts.nonTargetIncoming++;return;}
 if(!target&&state.targetSeen){state.counts.nonTargetAfterTarget++;return;}
 if(target&&!state.targetSeen){state.targetSeen=true;state.observedTarget={...scope,sourceRelativeFile:path.relative(sourceRoot,scope.file).replaceAll('\\','/'),firstObservedMethod:message.method,activationNs:process.hrtime.bigint().toString()};}
 state.counts.selected++;
 const record={connectionId,direction,method:message.method,id:message.id,sessionId:text(message.sessionId,128),nodeMonotonicNs:process.hrtime.bigint().toString(),wallTime:new Date().toISOString(),scope,params:parameters(message.method,message.params||{})};
 if(direction==='send'){const stack=new Error('selected outgoing protocol call').stack||'';record.stack=stack.split('\n').slice(0,14).map(l=>l.slice(0,260)).join('\n').slice(0,MAX_STACK_BYTES);if(stack.length>record.stack.length)state.counts.truncated++;}
 const encoded=JSON.stringify(record),bytes=Buffer.byteLength(encoded);
 if(bytes>MAX_RECORD_BYTES){state.counts.droppedBytes++;state.complete=false;return;}
 if(!target){while(state.preRoll.length&&(state.preRoll.length>=MAX_PREROLL||state.counts.bytes+bytes>MAX_BYTES)){const removed=state.preRoll.shift();const size=Buffer.byteLength(JSON.stringify(removed));state.preRollBytes-=size;state.counts.bytes-=size;state.counts.preRollEvicted++;}}
 if(state.records.length+state.preRoll.length>=MAX_RECORDS||state.counts.bytes+bytes>MAX_BYTES){state.counts.droppedRecords++;state.complete=false;return;}
 state.counts.bytes+=bytes;
 if(target)state.records.push(record);else{state.preRoll.push(record);state.preRollBytes+=bytes;}
}
function flush(){try{state.validTargetObservation=state.targetSeen&&state.complete&&state.exitObserved&&state.connectionsClosed===state.connections.length;state.validHostedTargetObservation=state.validTargetObservation&&!canaryOverride&&scopeRoot===sourceRoot;fs.mkdirSync(directory,{recursive:true});let encoded=JSON.stringify(state);while(Buffer.byteLength(encoded)>MAX_FILE_BYTES&&state.records.length){state.records.pop();state.counts.droppedBytes++;state.complete=false;state.validTargetObservation=false;state.validHostedTargetObservation=false;encoded=JSON.stringify(state);}fs.writeFileSync(output,encoded);return output;}catch{state.counts.errors++;state.complete=false;return undefined;}}
const originalLaunch=chromium.launch;
chromium.launch=async function(...args){
 const browser=await Reflect.apply(originalLaunch,this,args);
 if(state.connections.length>=MAX_CONNECTIONS){state.counts.droppedConnections++;state.complete=false;flush();return browser;}
 const id=state.connections.length+1;
 try{
  const client=browser._connection;
  if(typeof client?.toImpl!=='function')throw new Error('client connection has no toImpl');
  const impl=client.toImpl(browser),connection=impl?._connection;
  if(!connection||typeof connection._protocolLogger!=='function'||typeof connection._rawSend!=='function')throw new Error('resolved implementation is not a protocol-logger CRConnection');
  const original=connection._protocolLogger;
  const wrapper=function(direction,message){const value=Reflect.apply(original,this,[direction,message]);try{observe(id,direction,message);}catch{state.counts.errors++;state.complete=false;}return value;};
  connection._protocolLogger=wrapper;
  state.connections.push({id,admitted:true,browserVersion:browser.version(),implementation:impl.constructor.name,connection:connection.constructor.name,originalLoggerPreserved:true});
  browser.once('disconnected',()=>{state.connectionsClosed++;if(connection._protocolLogger===wrapper)connection._protocolLogger=original;flush();});
 }catch(error){state.connections.push({id,admitted:false,error:text(error.message,256)});state.counts.errors++;state.complete=false;}
 flush();return browser;
};
globalThis[Symbol.for('sourdaw.protocol-control-observer')]={state,flush};
process.once('exit',()=>{state.exitObserved=true;flush();});
