import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../photo-manager.html', import.meta.url), 'utf8');
const script = html.split('<script>', 2)[1].split('</script>', 1)[0];
const calendarCode = script.slice(script.indexOf('  var calendarFormMode = "new";'), script.indexOf('  function renderDatePicker()'));

test('Photo Manager script parses and offers the two one-step flows', () => {
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(html, /openCalendarForm\(null,"pending",true\)/);
  assert.match(html, /addDateToExistingFlyer\(/);
  assert.match(html, /id="calendar-flyer"/);
  assert.match(html, /Save \+ Another Date/);
});

function helpers(photos, pendingSrc = '') {
  const context = vm.createContext({
    Date, photos, pendingSrc, editingIndex:null, calendarEvents:[], copyCalendarEvents:[],
    document:{getElementById:()=>({value:'New Venue',classList:{contains:()=>true}})}
  });
  vm.runInContext(calendarCode, context);
  return context;
}

test('copying a legacy Westgate date reuses the existing undated flyer', () => {
  const photos = [{src:'westgate.mp4',name:'Westgate',eventIds:[],dates:['2026-11-01','2027-01-17']}];
  const ctx = helpers(photos);
  assert.equal(ctx.findPhotoForEvent({id:'older',title:'Rick Parma Live at Westgate',dateKey:'2026-11-01'}), '0');
  assert.equal(ctx.attachSavedEventToFlyer({id:'new-gig'}, {title:'Westgate',date:'2027-05-02'}, '0', null), true);
  assert.equal(photos.length, 1);
  assert.deepEqual(photos[0].dates, ['2026-11-01','2027-01-17','2027-05-02']);
  assert.deepEqual(photos[0].eventIds, ['new-gig']);
});

test('new venue flyer is saved and linked when the event is created', () => {
  const photos = [];
  const ctx = helpers(photos, 'https://rickparma.com/media/new-venue.mp4');
  assert.equal(ctx.attachSavedEventToFlyer({id:'show-123'}, {title:'New Venue',date:'2027-06-01'}, 'pending', null), true);
  assert.equal(photos.length, 1);
  assert.equal(photos[0].name, 'New Venue');
  assert.deepEqual(photos[0].eventIds, ['show-123']);
  assert.deepEqual(photos[0].dates, ['2027-06-01']);
});

test('editing a show retains its Google event ID and updates linked date', () => {
  const photos = [{src:'westgate.mp4',name:'Westgate',eventIds:['show-123'],dates:['2026-11-01']}];
  const ctx = helpers(photos);
  assert.equal(ctx.attachSavedEventToFlyer({id:'show-123'}, {title:'Westgate',date:'2026-12-01'}, '0',
    {id:'show-123',dateKey:'2026-11-01'}), true);
  assert.deepEqual(photos[0].eventIds, ['show-123']);
  assert.deepEqual(photos[0].dates, ['2026-12-01']);
});

async function runSave(mode) {
  const values = {
    'calendar-title':'Westgate','calendar-location':'Las Vegas','calendar-description':'Details',
    'calendar-payment-link':'https://example.com/tickets','calendar-date':'2026-12-04',
    'calendar-all-day':'','calendar-start':'21:00','calendar-end':'00:30','calendar-flyer':'0'
  };
  const elements = new Map(Object.entries(values).map(([id,value]) => [id,{value,checked:false}]));
  elements.set('calendar-save-status',{textContent:''});
  elements.set('calendar-save-button',{disabled:false});
  elements.set('calendar-save-another',{disabled:false});
  elements.set('calendar-form-home',{appendChild(){}});
  elements.set('calendar-date-form',{hidden:false,reportValidity:()=>true});
  const calls = [];
  const confirmations = [];
  const context = vm.createContext({
    Date,encodeURIComponent, CAL_ID:'rick-calendar', CAL_API_KEY:'test-key',
    calendarEvents:[],copyCalendarEvents:[],pendingSrc:'',editingIndex:null,GH_TOKEN:'test',
    photos:[{src:'westgate.mp4',name:'Westgate',eventIds:mode === 'edit' ? ['show-123'] : [],dates:['2026-11-01']}],
    document:{getElementById:id=>elements.get(id)},
    localStorage:{getItem:()=> '123-example.apps.googleusercontent.com'},
    window:{google:{accounts:{oauth2:{}}}},
    google:{accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:'test-token'})})}}},
    fetch:async (url,options) => {
      calls.push({kind:'calendar',url,options});
      return {ok:true,json:async()=>({id:'show-123'})};
    },
    save:async()=>{calls.push({kind:'save'});return true;},
    pushFlyersJson:async()=>{calls.push({kind:'publish'});},
    showConfirm:(message,isError)=>confirmations.push({message,isError}),
    setUploadStatus:()=>{}
  });
  vm.runInContext(calendarCode, context);
  vm.runInContext('chooseCalendarCopyMonth = async()=>{}; refreshCalendarDates = async()=>{}; renderCalendarManager = ()=>{};',context);
  if (mode === 'edit') vm.runInContext("calendarFormMode='edit';calendarSourceEvent={id:'show-123',dateKey:'2026-11-01'};",context);
  context.saveCalendarDate({preventDefault(){}});
  for (let i = 0; i < 25 && !confirmations.length; i++) await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(confirmations.length,1);
  assert.equal(confirmations[0].isError,false);
  assert.deepEqual(calls.map(c=>c.kind),['calendar','save','publish']);
  return calls[0];
}

test('one-step creation writes Google Calendar, then syncs and publishes the selected flyer', async () => {
  const action = await runSave('new');
  assert.equal(action.options.method,'POST');
  assert.match(action.url, /\/calendars\/rick-calendar\/events\?sendUpdates=none/);
  const body = JSON.parse(action.options.body);
  assert.equal(body.end.dateTime,'2026-12-05T00:30:00');
  assert.match(body.description,/Tickets \/ Payment: https:\/\/example.com\/tickets/);
});

test('editing writes PATCH to the original event instead of creating a duplicate', async () => {
  const action = await runSave('edit');
  assert.equal(action.options.method,'PATCH');
  assert.match(action.url, /\/calendars\/rick-calendar\/events\/show-123\?sendUpdates=none/);
});

test('website keeps previous dates when a reusable flyer gets its first event ID', () => {
  const site = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const section = site.slice(site.indexOf('    function buildFlyerMap(flyers) {'), site.indexOf('    function fetchEvents()'));
  const context = vm.createContext({});
  vm.runInContext(section,context);
  const map = context.buildFlyerMap([{src:'westgate.mp4',eventIds:['show-new'],dates:['2026-11-01']}]);
  assert.equal(map['event:show-new'],'westgate.mp4');
  assert.equal(map['date:2026-11-01'],'westgate.mp4');
});
