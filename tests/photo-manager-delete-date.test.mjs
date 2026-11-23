import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../photo-manager.html', import.meta.url), 'utf8');
const script = html.split('<script>', 2)[1].split('</script>', 1)[0];
const code = script.slice(script.indexOf('  var calendarFormMode = "new";'), script.indexOf('  function renderDatePicker()'));

test('Delete Date control exists and Photo Manager code parses', () => {
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(html, /id="calendar-delete-selected"/);
  assert.match(html, /onclick="deleteSelectedCalendarDate\(\)"/);
});

async function deleteScenario({confirmed=true,authorized=true,apiOK=true,publishOK=true}={}) {
  const fake = {id:'fake-nov24',dateKey:'2026-11-24',title:'Toga',label:'Nov 24 · TOGA'};
  const actual = {id:'actual-dec19',dateKey:'2026-12-19',title:'Toga',label:'Dec 19 · TOGA'};
  const photos = [
    {name:'Toga',src:'toga.mp4',dates:['2026-11-24','2026-12-19'],eventIds:['fake-nov24','actual-dec19']},
    {name:'Westgate',src:'westgate.mp4',dates:['2026-11-24'],eventIds:['westgate-other']}
  ];
  const calls=[],messages=[];
  const controls = new Map([
    ['calendar-copy-source',{value:'0'}],
    ['calendar-delete-selected',{disabled:false,textContent:'Delete Date'}],
    ['calendar-connection',{open:false}]
  ]);
  const context=vm.createContext({
    Date,encodeURIComponent,photos,calendarEvents:[fake,actual],copyCalendarEvents:[fake],
    CAL_ID:'test-calendar',GH_TOKEN:'test-token',pendingSrc:'',
    document:{getElementById:id => controls.get(id)},
    localStorage:{getItem:()=>authorized?'123-example.apps.googleusercontent.com':''},
    window:{google:{accounts:{oauth2:{}}}},
    google:{accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:'fake-token'})})}}},
    confirm:()=>confirmed,alert:message=>messages.push({message,error:true}),
    fetch:async(url,options)=>{
      calls.push({type:'google',url,options});
      return apiOK ? {ok:true,status:204} : {ok:false,status:403,json:async()=>({error:{message:'Permission denied'}})};
    },
    save:async()=>{calls.push({type:'save'});return true;},
    pushFlyersJson:async()=>{calls.push({type:'publish'});if(!publishOK)throw new Error('Flyer publish failed');},
    render:()=>{},showConfirm:(message,error)=>messages.push({message,error})
  });
  vm.runInContext(code,context);
  vm.runInContext('renderCalendarManager=()=>{}; renderDatePicker=()=>{}; refreshCalendarDates=async()=>{}; updateCalendarEditLink=()=>{};',context);
  context.deleteSelectedCalendarDate();
  for(let i=0;i<20 && calls.length===0 && confirmed && authorized;i++) await new Promise(resolve=>setTimeout(resolve,0));
  for(let i=0;i<20 && calls.some(x=>x.type==='google') && !messages.length;i++) await new Promise(resolve=>setTimeout(resolve,0));
  return {photos,calls,messages};
}

test('deletes only the chosen fake TOGA performance, not the December 19 show or generic flyer',async()=>{
  const result=await deleteScenario();
  assert.deepEqual(result.calls.map(c=>c.type),['google','save','publish']);
  assert.equal(result.calls[0].options.method,'DELETE');
  assert.match(result.calls[0].url,/events\/fake-nov24\?sendUpdates=none/);
  assert.equal(result.photos.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.photos[0].eventIds)),['actual-dec19']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.photos[0].dates)),['2026-12-19']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.photos[1].dates)),['2026-11-24']);
  assert.equal(result.messages.at(-1).error,false);
});

test('canceled confirmation does nothing',async()=>{
  const result=await deleteScenario({confirmed:false});
  assert.equal(result.calls.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.photos[0].eventIds)),['fake-nov24','actual-dec19']);
});

test('Google calendar denial does not unlink the flyer',async()=>{
  const result=await deleteScenario({apiOK:false});
  assert.deepEqual(result.calls.map(c=>c.type),['google']);
  assert.equal(result.messages.at(-1).error,true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.photos[0].dates)),['2026-11-24','2026-12-19']);
});

test('successful calendar deletion but failed flyer publish tells the user not to repeat deletion',async()=>{
  const result=await deleteScenario({publishOK:false});
  assert.deepEqual(result.calls.map(c=>c.type),['google','save','publish']);
  assert.match(result.messages.at(-1).message,/Date deleted from Google Calendar/);
  assert.match(result.messages.at(-1).message,/Do not delete the date again/);
});

test('missing OAuth authorization does not attempt a delete',async()=>{
  const result=await deleteScenario({authorized:false});
  assert.equal(result.calls.length,0);
  assert.match(result.messages.at(-1).message,/Connect Google Calendar/);
});
