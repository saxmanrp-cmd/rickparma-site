import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../photo-manager.html', import.meta.url), 'utf8');
const script = html.split('<script>', 2)[1].split('</script>', 1)[0];
const calendarCode = script.slice(script.indexOf('  var calendarFormMode = "new";'), script.indexOf('  function renderDatePicker()'));

test('past month loads shows from that month, not only upcoming events', async () => {
  const calls = [];
  const elements = new Map(['calendar-copy-month','calendar-copy-source','calendar-edit-selected'].map(id => [id, {
    value:'', innerHTML:'', hidden:true, removeAttribute() {},
  }]));
  const context = vm.createContext({
    Date, URL, encodeURIComponent, CAL_ID:'test-calendar', CAL_API_KEY:'test-key',
    calendarCopyMonth:new Date(2026,10,1), copyCalendarEvents:[],
    document:{getElementById:id => elements.get(id)},
    fetch:async url => {
      const search = new URL(url).searchParams;
      calls.push(search);
      return {ok:true,json:async()=>({items:[{
        id:'old-show', summary:'Westgate', description:'Bring saxophone',
        start:{dateTime:'2026-10-15T20:00:00-07:00'}, end:{dateTime:'2026-10-15T23:00:00-07:00'},
      }]})};
    },
  });
  vm.runInContext(calendarCode, context);
  await context.chooseCalendarCopyMonth('2026-10');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].get('timeMin').startsWith('2026-10-01'));
  assert.ok(calls[0].get('timeMax').startsWith('2026-11-01'));
  assert.match(elements.get('calendar-copy-source').innerHTML, /Westgate/);
  assert.equal(context.copyCalendarEvents[0].description, 'Bring saxophone');
});

test('direct calendar event retains description, all-day end, and overnight time', () => {
  const context = vm.createContext({Date});
  vm.runInContext(calendarCode, context);
  const timed = context.calendarEventBody({title:'Westgate',location:'Las Vegas',description:'Bring saxophone',
    date:'2026-12-04',start:'21:00',end:'00:30',allDay:false});
  assert.equal(timed.summary, 'Westgate');
  assert.equal(timed.description, 'Bring saxophone');
  assert.equal(timed.start.timeZone, 'America/Los_Angeles');
  assert.equal(timed.end.dateTime, '2026-12-05T00:30:00');
  const allDay = context.calendarEventBody({title:'Festival',location:'',description:'Full day',date:'2026-12-31',allDay:true});
  assert.equal(allDay.start.date, '2026-12-31');
  assert.equal(allDay.end.date, '2027-01-01');
});

test('Save sends the event directly to the selected Google calendar', async () => {
  let posted;
  const values = {
    'calendar-title':'Westgate', 'calendar-location':'Las Vegas', 'calendar-description':'Bring saxophone',
    'calendar-date':'2026-12-04', 'calendar-all-day':'', 'calendar-start':'21:00', 'calendar-end':'00:30',
  };
  const elements = new Map(Object.entries(values).map(([id,value]) => [id,{value,checked:false}]));
  elements.set('calendar-save-status',{textContent:''});
  elements.set('calendar-save-button',{disabled:false});
  elements.set('calendar-save-another',{disabled:false});
  elements.set('calendar-date-form',{hidden:false,reportValidity:()=>true});
  elements.set('calendar-form-home',{appendChild(){}});
  elements.set('calendar-flyer',{value:''});
  elements.set('calendar-payment-link',{value:''});
  const context = vm.createContext({
    Date, URL, encodeURIComponent, CAL_ID:'rick-calendar', CAL_API_KEY:'test-key',
    calendarCopyMonth:new Date(2026,10,1), copyCalendarEvents:[], calendarEvents:[],
    photos:[],GH_TOKEN:'test-token', pendingSrc:'',
    document:{getElementById:id=>elements.get(id)},
    localStorage:{getItem:()=> '123-example.apps.googleusercontent.com'},
    window:{google:{accounts:{oauth2:{}}}},
    google:{accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:'test-token'})})}}},
    fetch:async (url,options)=>{
      posted={url,options};
      return {ok:true,json:async()=>({id:'saved-event'})};
    },
    closeCalendarForm:()=>{}, chooseCalendarCopyMonth:async()=>{}, refreshCalendarDates:async()=>{},
    showConfirm:()=>{},render:()=>{},save:async()=>true,
  });
  vm.runInContext(calendarCode, context);
  // Replace the refresh functions so this test only exercises the save path.
  vm.runInContext('chooseCalendarCopyMonth = async () => {}; refreshCalendarDates = async () => {}; renderCalendarManager = () => {}', context);
  context.saveCalendarDate({preventDefault(){}});
  for (let i=0;i<20 && !posted;i++) await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(posted);
  assert.match(posted.url,/\/calendars\/rick-calendar\/events/);
  assert.equal(posted.options.headers.Authorization,'Bearer test-token');
  const saved=JSON.parse(posted.options.body);
  assert.equal(saved.description,'Bring saxophone');
  assert.equal(saved.end.dateTime,'2026-12-05T00:30:00');
});
