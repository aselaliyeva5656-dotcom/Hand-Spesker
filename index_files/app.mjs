import {PhoneAudioPlayer} from './phone-audio.mjs?v=8';
import {FIXED_AUDIO,FIXED_TEXTS} from './fixed-audio.mjs?v=8';
import {LETTERS,PHRASES,CATEGORIES,cleanProfile,introText,normalizePhone,gestureAction,HoldGate,DwellGate} from './core.mjs?v=8';
import {makeSpeechPlan} from './voice-plan.mjs?v=8';
import {KazakhAudioPlayer} from './audio-player.mjs?v=8';
import {ClipStore,createAudioRecorder,microphoneError} from './recording.mjs?v=8';
const $=id=>document.getElementById(id);
const STORAGE='menin-dauysym-v1';
const phonePlayer=new PhoneAudioPlayer($('speech-audio'));
const savedClips=new Map();
let saved={};try{saved=JSON.parse(localStorage.getItem(STORAGE)||'{}')||{};}catch{}
let profile=cleanProfile(saved.profile),mode='phrases',lastText='Сәлем!',numbers=false,category='basic';
let personalPhrases=Array.isArray(saved.phrases)?saved.phrases.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim().slice(0,300)).slice(0,12):[];
let hold=450,voiceChoice=saved.voice??'';
hold=Math.max(300,Math.min(1500,Number(saved.version===2?saved.hold:450)||450));
let voices=[],currentAudio=null,currentAudioURL=null,speechEpoch=0;
let audioContext=null,recorder=null,micStream=null,recordTimer=null,recordingText='',recordCancelled=false;
let cameraStream=null,recognizer=null,cameraRunning=false,cameraBusy=false,raf=null,lastFrame=0,lastVideo=-1;
let gate=new HoldGate(hold),dwell=new DwellGate(1000),lastCall=-Infinity;
let scanTimer=null,typingTimer=null,speechRequest=null;
const audioPlayer=new KazakhAudioPlayer(()=>{unlockAudio();if(!audioContext)throw new Error('Audio unavailable');return audioContext;});
const audioBankReady=fetch('./assets/audio/manifest.json?v=8').then(r=>{if(!r.ok)throw new Error('Audio bank missing');return r.json();});
audioBankReady.catch(()=>{setSpeechStatus('Қазақша дыбыстар жүктелмеді. Интернетті тексеріп, бетті жаңарт.');});
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({profile,phrases:personalPhrases,hold,voice:voiceChoice,version:2}));return true;}catch{return false;}}
function setSpeechStatus(text){$('speech-status').textContent=text;}
function showMessage(text,isHelp=false){lastText=text;$('message-text').textContent=text;document.querySelector('.message').classList.toggle('help-active',isHelp);}
function stopSound(){clearTimeout(typingTimer);speechEpoch++;speechRequest?.abort();speechRequest=null;audioPlayer.stop();phonePlayer.stop();if('speechSynthesis'in window)window.speechSynthesis.cancel();if(currentAudio){currentAudio.pause();currentAudio=null;}if(currentAudioURL){URL.revokeObjectURL(currentAudioURL);currentAudioURL=null;}}
function unlockAudio(){phonePlayer.prime();try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();audioContext.resume().catch(()=>{});}catch{}}
function beep(){try{const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='sine';o.frequency.value=660;o.connect(g);g.connect(audioContext.destination);g.gain.setValueAtTime(.12,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.65);o.start();o.stop(audioContext.currentTime+.65);}catch{}}
const clipStore=new ClipStore();
const clip=async(action,text,blob)=>{const result=await clipStore.action(action,text,blob);if(action==='put')savedClips.set(text,blob);if(action==='get'&&result instanceof Blob)savedClips.set(text,result);if(action==='delete')savedClips.delete(text);if(action==='clear')savedClips.clear();return result;};
async function speak(text){
 text=String(text??'').trim();if(!text){setSpeechStatus('Алдымен сөйлем жаз.');return;}
 stopSound();const epoch=speechEpoch;setSpeechStatus('Қазақша дыбыс дайындалуда…');
 const fixedFile=FIXED_AUDIO[text.toLocaleLowerCase('kk')];
 const cachedClip=savedClips.get(text);
 const onstart=()=>{if(epoch===speechEpoch)setSpeechStatus('Қазақша айтылуда…');};
 const onend=()=>{if(epoch===speechEpoch)setSpeechStatus('Сөйлем айтылды.');};
 if(fixedFile||cachedClip){
  try{const played=cachedClip?await phonePlayer.playBlob(cachedClip,onstart,onend):await phonePlayer.playURL('/api/audio/'+fixedFile,onstart,onend);if(played)return;}
  catch{if(epoch!==speechEpoch)return;}
  if(epoch!==speechEpoch)return;
  // Keep Web Audio as a backup when native media is unavailable.
  if(fixedFile){await playBankPlan({files:[fixedFile],spelled:false},epoch);return;}
 }

 try{
  let recording=null;try{recording=await clip('get',text);}catch{}
  if(epoch!==speechEpoch)return;
  if(recording instanceof Blob){
   try{const played=await phonePlayer.playBlob(recording,onstart,onend);if(played)return;}
   catch{if(epoch!==speechEpoch)return;}
  }
  const bank=await audioBankReady;if(epoch!==speechEpoch)return;
  const plan=makeSpeechPlan(text,bank,profile,introText(profile));
  const fixed=Object.values(bank.phrases).some(p=>p.text.toLocaleLowerCase('kk')===text.toLocaleLowerCase('kk'));
  if(!fixed){
   try{speechRequest=new AbortController();const response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:speechRequest.signal});if(!response.ok)throw new Error('Unavailable');const blob=await response.blob();if(epoch!==speechEpoch)return;if(personalPhrases.includes(text)||text===introText(profile))clip('put',text,blob).catch(()=>{});const played=await phonePlayer.playBlob(blob,onstart,onend);if(played)return;}
   catch{if(epoch!==speechEpoch)return;}
  }
  if(plan.spelled){setSpeechStatus('Толық сөйлемнің дауысы дайындалмады. Интернетті тексер немесе «Мен туралы» бөлімінде осы сөйлемге адам дауысын жазып сақта.');return;}
  await playBankPlan(plan,epoch);
 }catch{if(epoch===speechEpoch)setSpeechStatus('Дыбысты қосу үшін «Дыбысты тексеру» батырмасын бас. Интернет пен дыбыс деңгейін тексер.');}
}
async function playBankPlan(plan,epoch){
 if(epoch!==speechEpoch)return;
 if(!plan.files.length){setSpeechStatus('Бұл мәтінге дыбыс табылмады. Қазақша әріптермен жаз.');return;}
 try{const played=await audioPlayer.play(plan.files,()=>{if(epoch===speechEpoch)setSpeechStatus(plan.spelled?'Қазақша әріптеп оқылуда…':'Бала атынан қазақша айтылуда…');});if(played&&epoch===speechEpoch)setSpeechStatus('Сөйлем айтылды.');}
 catch{if(epoch===speechEpoch)setSpeechStatus('Дыбыс басталмады. «Қайталау» батырмасын бас. Телефонның дыбыс деңгейін тексер.');}
}
function refreshVoices(){
 const select=$('voice-select');select.replaceChildren();select.add(new Option('Қазақша табиғи дауыс — Daulet',''));select.value='';
 $('voice-notice').hidden=true;
 $('voice-description').textContent='Суретті батырмалар дайын қазақша аудиомен бірден сөйлейді. Жеке мәлімет пен еркін мәтін тұтас сөйлеммен оқылады (интернет керек). Нақты адам дауысын қолдану үшін төменде сөйлемді таңдап, микрофонмен жазып сақта: кейін сол жазба автоматты айтылады.';
}
function phraseText(id){return id==='intro'?(profile.name||profile.age||profile.address?introText(profile):'Сәлем! Менің айтарым бар.'):PHRASES.find(p=>p.id===id)?.text??'';}
function sayPhrase(id){unlockAudio();const text=phraseText(id);showMessage(text,id==='help');speak(text);refreshRecordTargets();}
function openCategory(id){category=id;setMode('phrases');renderPhrases();}
function openTopics(){unlockAudio();setMode('phrases');if(!$('topics-dialog').open)$('topics-dialog').showModal();}
function renderTopics(){for(const c of CATEGORIES){const b=document.createElement('button');const icon=document.createElement('span');icon.textContent=c.icon;const text=document.createElement('strong');text.textContent=c.title;b.append(icon,text);b.addEventListener('click',()=>{$('topics-dialog').close();openCategory(c.id);$('phrase-grid').scrollIntoView({block:'nearest',behavior:'auto'});});$('topic-options').append(b);}}
function renderPhrases(){
 $('category-tabs').replaceChildren();
 for(const c of CATEGORIES){const b=document.createElement('button');b.textContent=c.icon+' '+c.title;b.className=category===c.id?'active':'';b.setAttribute('aria-pressed',String(category===c.id));b.addEventListener('click',()=>openCategory(c.id));$('category-tabs').append(b);}
 $('phrase-grid').replaceChildren();
 const quick=['yes','no','food','water','toilet-go','help'];
 const shown=category==='basic'?quick.map(id=>PHRASES.find(p=>p.id===id)):PHRASES.filter(p=>p.category===category);
 for(const p of shown){
  const button=document.createElement('button');button.className=`phrase ${p.color}`;button.setAttribute('aria-label',p.id==='intro'?'Өзімді таныстыру':p.text);
  const picture=document.createElement('img');picture.src='./assets/pictures/'+p.id+'.svg';picture.alt='';picture.width=80;picture.height=80;
  const title=document.createElement('strong');title.textContent=p.title;button.append(picture,title);button.addEventListener('click',()=>sayPhrase(p.id));$('phrase-grid').append(button);
 }
}
function renderPersonalPhrases(){
 $('personal-grid').replaceChildren();$('personal-empty').hidden=personalPhrases.length>0;$('saved-phrases').hidden=personalPhrases.length===0;
 for(const text of personalPhrases){const item=document.createElement('div');item.className='personal-phrase';const button=document.createElement('button');button.textContent='🔊 '+text;button.addEventListener('click',()=>{unlockAudio();showMessage(text);speak(text);});const remove=document.createElement('button');remove.className='quiet';remove.textContent='×';remove.setAttribute('aria-label','Сөйлемді өшіру: '+text);remove.addEventListener('click',()=>{personalPhrases=personalPhrases.filter(x=>x!==text);persist();renderPersonalPhrases();refreshRecordTargets();});item.append(button,remove);$('personal-grid').append(item);}
}
async function savePersonalPhrase(text){
 text=String(text||'').trim().slice(0,300);if(!text){$('personal-status').textContent='Алдымен айтылатын сөйлемді жаз.';return;}
 if(!personalPhrases.includes(text)){if(personalPhrases.length>=12){$('personal-status').textContent='12 сөйлем сақталған. Біреуін өшіріп, жаңасын қос.';return;}personalPhrases.push(text);}
 const stored=persist();renderPersonalPhrases();refreshRecordTargets();$('personal-text').value='';
 $('personal-status').textContent=stored?'Сөйлем сақталды. Қазақша дауысы дайындалуда…':'Сөйлем осы сессияға қосылды. Браузерге мәтінді сақтау қолжетімсіз.';
 showMessage(text);await prepareVoice(text,'personal-status',stored?'Сөйлем мен қазақша дауысы сақталды. Сөйлемді бассаң, өзі оқиды.':'Дауысы сақталды, мәтін осы сессияда қолданылады.');
}
async function prepareVoice(text,statusId,success='Қазақша дауыс сақталды. Белгі көрсеткенде немесе сөйлемді басқанда автоматты оқиды.'){
 text=String(text||'').trim();if(!text){$(statusId).textContent='Алдымен сөйлемді жаз.';return;}
 unlockAudio();$(statusId).textContent='Қазақша дауыс дайындалуда…';
 try{const bank=await audioBankReady;const fixed=Object.values(bank.phrases).find(p=>p.text.toLocaleLowerCase('kk')===text.toLocaleLowerCase('kk'));const response=fixed?await fetch('./assets/audio/'+fixed.file):await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});if(!response.ok)throw new Error('Speech unavailable');const blob=await response.blob();if(!blob.size)throw new Error('Speech unavailable');await clip('put',text,blob);$(statusId).textContent=success;showMessage(text);await speak(text);return true;}
 catch(error){$(statusId).textContent=error.message==='Storage unavailable'?'Мәтін қосылды, бірақ дауыс осы браузерге сақталмады. Сайтты Chrome немесе Safari-де ашып көр.':'Мәтін сақталды, дауыс дайындалмады. Интернетті тексеріп, «Мәтіннен дауыс сақтау» батырмасын қайта бас.';showMessage(text);await speak(text);return false;}
}
function setMode(next){clearTimeout(typingTimer);mode=next;for(const button of document.querySelectorAll('[data-mode]')){const active=button.dataset.mode===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}for(const id of ['phrases','write','settings'])$(id+'-panel').hidden=id!==mode;dwell.reset();clearDwell();if(mode==='settings')refreshRecordTargets();updateScanLoop();}
function renderKeyboard(){$('keyboard').replaceChildren();for(const key of numbers?'0123456789'.split(''):LETTERS){const b=document.createElement('button');b.dataset.key=key;b.textContent=key;b.type='button';$('keyboard').append(b);}dwell.reset();clearDwell();renderScan();}
function applyKey(key){if(key==='phrases'){setMode('phrases');return;}const textarea=$('compose');if(key==='speak'){clearTimeout(typingTimer);const text=textarea.value.trim();if(text){showMessage(text);speak(text);}else setSpeechStatus('Алдымен әріптерді таңда.');return;}if(key==='clear'){textarea.value='';}else if(key==='backspace'){textarea.value=Array.from(textarea.value).slice(0,-1).join('');}else if(textarea.value.length<300){textarea.value+=key==='space'?' ':key;}showMessage(textarea.value||'Сөйлем құрастыр…');refreshRecordTargets();scheduleTypedSpeech();}
let highlighted=null;
function clearDwell(){if(highlighted){highlighted.classList.remove('dwell-target');highlighted.style.removeProperty('--hold');highlighted=null;}$('hand-cursor').hidden=true;}
function renderScan(){document.querySelectorAll('[data-key]').forEach(b=>b.classList.remove('scan-active'));}
function updateScanLoop(){clearInterval(scanTimer);scanTimer=null;clearDwell();renderScan();}
function refreshProfile(){
 $('profile-name').value=profile.name;$('profile-age').value=profile.age;$('profile-address').value=profile.address;
 $('mother-phone').value=profile.motherPhone;$('father-phone').value=profile.fatherPhone;$('preferred-contact').value=profile.preferredContact;
 const who=profile.preferredContact==='father'?'Әкем':'Анам';const phone=profile.preferredContact==='father'?profile.fatherPhone:profile.motherPhone;
 $('saved-contact').textContent=phone?`${who}: ${phone}`:'Анаң мен әкеңнің нөмірін «Мен туралы» бөлімінде сақта.';
 $('call-button').textContent=who+' — қоңырау';
}
function openCall(fromGesture=false,person=profile.preferredContact){
 const phone=person==='father'?profile.fatherPhone:profile.motherPhone,who=person==='father'?'Әкем':'Анам';
 if(!phone){setMode('settings');$('contact-status').textContent=who+' нөмірін енгізіп сақта.';$(person==='father'?'father-phone':'mother-phone').focus();return;}
 const now=performance.now();if(fromGesture&&now-lastCall<30000)return;lastCall=now;
 stopSound();showMessage(`${who}: ${phone}`);setSpeechStatus('Қоңырауды телефон экранынан раста.');
 $('call-title').textContent=who+' — қоңырау';$('call-details').textContent=phone;$('call-link').href='tel:'+phone;
 if(!$('call-dialog').open)$('call-dialog').showModal();
 try{window.location.assign('tel:'+phone);}catch{}
}
function dispatchGesture(action){
 if(['help','intro','food','water','toilet'].includes(action)){if(action==='toilet')openCategory('school');sayPhrase(action);}
 else if(action==='food-menu'){openCategory('food');showMessage('Тамақ пен су: суретті таңда.');$('phrase-grid').scrollIntoView({block:'nearest',behavior:'auto'});}
 else if(action==='write'){setMode('write');showMessage('Әріптермен жазу режимі ашылды.');speak('Әріптермен жазу режимі ашылды.');if(matchMedia('(max-width: 750px)').matches)$('key-area').scrollIntoView({block:'center',behavior:'auto'});}
 else if(action==='speak')applyKey('speak');else if(action==='phrases')setMode('phrases');
 else if(action==='topics')openTopics();else if(action==='call')openCall(true);
}
const gestureNames={Pointing_Up:'☝️ Анама / әкеме қоңырау',Thumb_Up:'👍 Әріптер / сөйлемді айту',Open_Palm:'🖐️ Мен туралы',Thumb_Down:'👎 Тамақ пен су',Victory:'✌️ Тақырыптарды ашу'};
const CONNECTIONS=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
function drawHand(landmarks){const canvas=$('camera-canvas'),video=$('camera-video');if(canvas.width!==video.videoWidth){canvas.width=video.videoWidth;canvas.height=video.videoHeight;}const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);if(!landmarks)return;ctx.strokeStyle='#a0e3bd';ctx.lineWidth=3;for(const [a,b]of CONNECTIONS){ctx.beginPath();ctx.moveTo(landmarks[a].x*canvas.width,landmarks[a].y*canvas.height);ctx.lineTo(landmarks[b].x*canvas.width,landmarks[b].y*canvas.height);ctx.stroke();}ctx.fillStyle='#fac67c';for(const p of landmarks){ctx.beginPath();ctx.arc(p.x*canvas.width,p.y*canvas.height,4,0,Math.PI*2);ctx.fill();}}
async function startCamera(){
 if(cameraBusy||cameraRunning)return;cameraBusy=true;unlockAudio();speak('Дыбыс қосылды. Қол белгісін көрсетіңіз.');audioBankReady.then(b=>audioPlayer.preload(Object.values(b.phrases).map(p=>p.file))).catch(()=>{});$('camera-start').disabled=true;$('camera-status').textContent='Камера мен қимыл тану дайындалуда…';
 let stream=null;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Камера бұл браузерде қолжетімсіз.');
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});cameraStream=stream;
  const video=$('camera-video');video.srcObject=stream;await video.play();
  if(!recognizer){const {GestureRecognizer,FilesetResolver}=await import('./assets/vision_bundle.mjs');const vision=await FilesetResolver.forVisionTasks('./assets/wasm');recognizer=await GestureRecognizer.createFromOptions(vision,{baseOptions:{modelAssetPath:'./assets/gesture_recognizer.task',delegate:'CPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.6});}
  if(document.hidden){stopCamera();return;}
  gate.reset();dwell.reset();cameraRunning=true;updateScanLoop();lastFrame=0;lastVideo=-1;$('camera-placeholder').hidden=true;$('camera-stop').hidden=false;$('camera-start').hidden=true;$('camera-badge').textContent='Қосулы';$('camera-badge').classList.add('live');$('camera-status').textContent='✌️ — тақырыптар. ☝️ — қоңырау үшін 2,4 секунд ұста. Суреттерді бассаң, сөйлем айтылады.';
  raf=requestAnimationFrame(cameraLoop);
 }catch(error){stopCamera();const denied=error.name==='NotAllowedError';$('camera-status').textContent=denied?'Камераға рұқсат берілмеді. Браузердің рұқсатын тексер немесе батырмаларды пайдалан.':error.name==='NotFoundError'?'Камера табылмады. Батырмаларды пайдалана бер.':'Камера немесе қимыл тану іске қосылмады. Батырмалар жұмыс істейді. Қайта қосып көр.';}
 finally{cameraBusy=false;$('camera-start').disabled=false;}
}
function stopCamera(){clearInterval(scanTimer);scanTimer=null;cameraRunning=false;if(raf)cancelAnimationFrame(raf);raf=null;if(cameraStream)cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;$('camera-video').srcObject=null;$('camera-canvas').getContext('2d').clearRect(0,0,$('camera-canvas').width,$('camera-canvas').height);$('camera-placeholder').hidden=false;$('camera-stop').hidden=true;$('camera-start').hidden=false;$('camera-badge').textContent='Өшірулі';$('camera-badge').classList.remove('live');$('gesture-label').textContent='Камера қосылмаған';$('hold-progress').style.width='0%';clearDwell();gate.reset();dwell.reset();}
function cameraLoop(now){
 if(!cameraRunning)return;
 try{const video=$('camera-video');if(now-lastFrame>=90&&video.readyState>=2&&video.currentTime!==lastVideo){
  lastFrame=now;lastVideo=video.currentTime;
  const result=recognizer.recognizeForVideo(video,now);const lm=result.landmarks?.[0],category=result.gestures?.[0]?.[0];const name=category?.categoryName,score=category?.score??0;
  drawHand(lm);
  const threshold=name==='Pointing_Up'?.8:.65;
  const dialogOpen=$('call-dialog').open||$('topics-dialog').open;let action=score>=threshold?gestureAction(name,mode):null;if(dialogOpen)action=null;
  const usable=!!action;
  $('gesture-label').textContent=lm?(usable?(gestureNames[name]??'Қимыл танылды'):(gestureNames[name]?'Белгіні анық көрсет: '+Math.round(score*100)+'%':'Қол көрінді. Бір белгіні анық көрсет.')):'Қолды камераға көрсет';
  gate.hold=action==='call'?Math.max(2400,hold):hold;gate.threshold=threshold;
  // Latch the pose rather than the action, so a mode change cannot fire the same held sign twice.
  const hit=dialogOpen?{progress:0,fire:null}:gate.update(usable?name:null,score,now);$('hold-progress').style.width=hit.progress*100+'%';
  dwell.update(null,now);clearDwell();
  if(hit.fire){dispatchGesture(gestureAction(hit.fire,mode));$('gesture-label').textContent=(gestureNames[hit.fire]??'Қимыл')+' ✓';}

 }}catch{stopCamera();$('camera-status').textContent='Қимыл тану тоқтады. Қайта қос немесе батырмаларды пайдалан.';return;}
 raf=requestAnimationFrame(cameraLoop);
}
function refreshRecordTargets(){if(recorder?.state==='recording')return;const target=$('record-target'),previous=target.value;target.replaceChildren();for(const p of PHRASES)target.add(new Option(`${p.title}: ${phraseText(p.id)}`,p.id));personalPhrases.forEach((text,i)=>target.add(new Option('Менің сөйлемім: '+text,'personal-'+i)));target.add(new Option('Жазылған / соңғы сөйлем','custom'));target.value=[...target.options].some(x=>x.value===previous)?previous:'help';$('record-text').textContent=recordTargetText();}
function recordTargetText(){const value=$('record-target').value;return value==='custom'?$('compose').value.trim()||lastText:value.startsWith('personal-')?personalPhrases[Number(value.slice(9))]||'':phraseText(value);}
function recordControls(active){$('record-start').disabled=active;$('record-stop').disabled=!active;$('record-target').disabled=active;$('record-generate').disabled=active;$('record-play').disabled=active;$('record-delete').disabled=active;}
async function startRecording(){
 if(recorder?.state==='recording')return;const text=recordTargetText();if(!text)return;
 if(!window.MediaRecorder||!navigator.mediaDevices?.getUserMedia){$('record-status').textContent='Бұл браузер дыбыс жазуды қолдамайды.';return;}
 $('record-start').disabled=true;$('record-status').textContent='Микрофонға рұқсат бер. Жазбаға дайындалуда…';stopSound();unlockAudio();
 try{
  if(!await clipStore.open())throw new Error('Storage unavailable');
  micStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});recordingText=text;recordCancelled=false;
  if(document.hidden){micStream.getTracks().forEach(t=>t.stop());micStream=null;throw new Error('Page hidden');}
  const chunks=[];recorder=createAudioRecorder(micStream);const current=recorder,targetText=text;
  current.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  current.onerror=e=>{recordCancelled=true;$('record-status').textContent=microphoneError(e.error);try{if(current.state!=='inactive')current.stop();}catch{}micStream?.getTracks().forEach(t=>t.stop());recordControls(false);};
  current.onstop=async()=>{clearTimeout(recordTimer);micStream?.getTracks().forEach(t=>t.stop());micStream=null;const blob=new Blob(chunks,{type:current.mimeType||chunks[0]?.type||'audio/webm'});recorder=null;if(recordCancelled){recordControls(false);return;}$('record-status').textContent='Жазба сақталуда…';try{if(!blob.size)throw new Error('Empty recording');await clip('put',targetText,blob);$('record-status').textContent='Дауысы сақталды. Осы сөйлем таңдалғанда автоматты оқылады. «Тыңдау» арқылы тексер.';}catch{$('record-status').textContent=blob.size?'Жазба сақталмады. Құрылғы жадын тексер немесе мәтіннен дауыс сақта.':'Дыбыс жазылмады. 2–3 секунд сөйлемді оқып, қайта тоқтат.';}finally{recordControls(false);}};
  current.start(250);recordControls(true);const started=Date.now();$('record-status').textContent='🔴 Жазылуда · 0 / 20 с. Сөйлемді оқы, кейін «Тоқтатып сақтау» батырмасын бас.';recordTimer=setInterval(()=>{const seconds=Math.floor((Date.now()-started)/1000);$('record-status').textContent=`🔴 Жазылуда · ${seconds} / 20 с. Сөйлемді оқып, тоқтат.`;if(seconds>=20&&current.state==='recording')current.stop();},500);
 }catch(error){$('record-status').textContent=microphoneError(error);recordControls(false);micStream?.getTracks().forEach(t=>t.stop());micStream=null;}
}
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
$('repeat').addEventListener('click',()=>{unlockAudio();speak(lastText);});$('stop-speech').addEventListener('click',()=>{stopSound();setSpeechStatus('Дыбыс тоқтатылды.');});
$('key-area').addEventListener('click',e=>{const b=e.target.closest('[data-key]');if(b){unlockAudio();applyKey(b.dataset.key);}});$('toggle-numbers').addEventListener('click',()=>{numbers=!numbers;$('toggle-numbers').textContent=numbers?'АӘБ Әріптер':'123 Сандар';renderKeyboard();});$('compose').addEventListener('input',()=>{unlockAudio();showMessage($('compose').value||'Сөйлем құрастыр…');refreshRecordTargets();scheduleTypedSpeech();});
$('profile-form').addEventListener('submit',async e=>{e.preventDefault();unlockAudio();profile=cleanProfile({...profile,name:$('profile-name').value,age:$('profile-age').value,address:$('profile-address').value});const stored=persist();refreshProfile();refreshRecordTargets();await prepareVoice(phraseText('intro'),'profile-status',stored?'Мәлімет пен қазақша дауысы сақталды. 🖐️ Ашық алақан көрсетсең, өзі оқиды.':'Дауыс сақталды. Мәлімет осы сессияда қолданылады; браузерге мәтінді сақтау қолжетімсіз.');});
$('personal-form').addEventListener('submit',e=>{e.preventDefault();unlockAudio();savePersonalPhrase($('personal-text').value);});
$('save-composed').addEventListener('click',()=>{setMode('settings');$('personal-text').value=$('compose').value.trim();$('personal-text').focus();$('personal-form').scrollIntoView({block:'center',behavior:'auto'});});
$('profile-listen').addEventListener('click',()=>sayPhrase('intro'));
$('record-generate').addEventListener('click',async()=>{$('record-generate').disabled=true;try{await prepareVoice(recordTargetText(),'record-status');}finally{$('record-generate').disabled=false;}});
$('contact-form').addEventListener('submit',e=>{e.preventDefault();const motherPhone=normalizePhone($('mother-phone').value),fatherPhone=normalizePhone($('father-phone').value);if(motherPhone===null||fatherPhone===null){$('contact-status').textContent='Нөмірді тексер. Мысалы: +7 және 10 цифр.';return;}profile=cleanProfile({...profile,motherPhone,fatherPhone,preferredContact:$('preferred-contact').value});$('contact-status').textContent=persist()?'Нөмірлер сақталды. ☝️ белгісі таңдалған адамға қоңырау ашады.':'Нөмірлер осы сессияда қолданылады.';refreshProfile();});
$('voice-select').addEventListener('change',()=>{voiceChoice=$('voice-select').value;persist();refreshVoices();});
$('hold-time').value=hold;$('hold-value').textContent=(hold/1000).toFixed(1).replace('.',',')+' с';$('hold-time').addEventListener('input',()=>{hold=+$('hold-time').value;gate.hold=hold;gate.reset();dwell.reset();$('hold-value').textContent=(hold/1000).toFixed(1).replace('.',',')+' с';persist();});
$('camera-start').addEventListener('click',startCamera);$('camera-stop').addEventListener('click',()=>{stopCamera();$('camera-status').textContent='Камера өшірілді. Батырмалар арқылы сөйлесуге болады.';});
$('call-button').addEventListener('click',()=>openCall());$('call-mother').addEventListener('click',()=>openCall(false,'mother'));$('call-father').addEventListener('click',()=>openCall(false,'father'));$('call-close').addEventListener('click',()=>$('call-dialog').close());
$('record-target').addEventListener('change',()=>{$('record-text').textContent=recordTargetText();$('record-status').textContent='Осы сөйлемнің дауысын жазуға болады.';});$('record-start').addEventListener('click',startRecording);$('record-stop').addEventListener('click',()=>{if(recorder?.state==='recording')recorder.stop();});$('record-play').addEventListener('click',async()=>{unlockAudio();const text=recordTargetText();try{const blob=await clip('get',text);if(!blob){$('record-status').textContent='Бұл сөйлемге жазба әлі қосылмады.';return;}showMessage(text);speak(text);}catch{$('record-status').textContent='Жазба ашылмады.';}});$('record-delete').addEventListener('click',async()=>{try{await clip('delete',recordTargetText());$('record-status').textContent='Осы сөйлемнің жазбасы өшірілді.';}catch{$('record-status').textContent='Жазба өшірілмеді.';}});
$('clear-data').addEventListener('click',async()=>{if(!window.confirm('Осы браузердегі атыңды, жасыңды, мекенжайды, телефон нөмірін және дауыс жазбаларын өшіреміз бе?'))return;stopSound();if(recorder?.state==='recording'){recordCancelled=true;recorder.stop();}try{await clip('clear');localStorage.removeItem(STORAGE);profile=cleanProfile({});personalPhrases=[];renderPersonalPhrases();voiceChoice='';refreshProfile();refreshVoices();refreshRecordTargets();showMessage('Сәлем!');$('profile-status').textContent='Мәліметтер өшірілді.';}catch{$('profile-status').textContent='Кейбір мәлімет өшірілмеді. Браузердің сайт деректерін тазала.';}});
$('topics-close').addEventListener('click',()=>$('topics-dialog').close());$('open-topics').addEventListener('click',openTopics);
$('open-guide').addEventListener('click',()=>{$('guide').open=true;$('guide').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});});
function cleanup(){clearTimeout(typingTimer);clearInterval(scanTimer);stopCamera();stopSound();if(recorder?.state==='recording'){recordCancelled=true;recorder.stop();}micStream?.getTracks().forEach(t=>t.stop());}
function scheduleTypedSpeech(){clearTimeout(typingTimer);stopSound();const text=$('compose').value.trim();if(!$('auto-speak').checked||!text)return;typingTimer=setTimeout(()=>{if(mode==='write'&&$('compose').value.trim()===text){showMessage(text);speak(text);}},1400);}
$('auto-speak').addEventListener('change',scheduleTypedSpeech);

$('audio-test').addEventListener('click',()=>{unlockAudio();showMessage('Дыбыс қосылды. Қол белгісін көрсетіңіз.');speak('Дыбыс қосылды. Қол белгісін көрсетіңіз.');});
window.addEventListener('pagehide',cleanup);document.addEventListener('visibilitychange',()=>{if(document.hidden)cleanup();});
for(const text of [...FIXED_TEXTS,...personalPhrases,introText(profile)])clip('get',text).catch(()=>{});
renderTopics();renderPhrases();renderPersonalPhrases();renderKeyboard();refreshProfile();refreshVoices();refreshRecordTargets();if('speechSynthesis'in window)window.speechSynthesis.addEventListener('voiceschanged',refreshVoices);

if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
