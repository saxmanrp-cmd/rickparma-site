import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../photo-manager.html', import.meta.url), 'utf8');
const script = html.split('<script>', 2)[1].split('</script>', 1)[0];
const helper = script.match(/function fmtDateKey\(d\) \{[\s\S]*?\n  \}/)?.[0];
const template = script.match(/function calendarTemplateUrl\(event\) \{[\s\S]*?\n  \}\n  function saveCalendarDate/)?.[0].replace(/\n  function saveCalendarDate$/, '');

test('duplicated timed show retains the Google Calendar description and spans midnight', () => {
  assert.ok(helper && template);
  const context = vm.createContext({ URL, Date });
  vm.runInContext(`${helper}\n${template}`, context);
  const url = new URL(context.calendarTemplateUrl({
    title:'Rick Parma at Westgate', location:'Westgate Las Vegas',
    description:'Set list notes\nBring saxophone.\nhttps://example.com/info',
    date:'2026-12-04', start:'21:00', end:'00:30', allDay:false,
  }));
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('text'), 'Rick Parma at Westgate');
  assert.equal(url.searchParams.get('location'), 'Westgate Las Vegas');
  assert.equal(url.searchParams.get('details'), 'Set list notes\nBring saxophone.\nhttps://example.com/info');
  const [start,end] = url.searchParams.get('dates').split('/');
  const parse = value => Date.parse(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}Z`);
  assert.equal((parse(end) - parse(start)) / 60000, 210);
});

test('all-day duplicate includes one full day and no time', () => {
  const context = vm.createContext({ URL, Date });
  vm.runInContext(`${helper}\n${template}`, context);
  const url = new URL(context.calendarTemplateUrl({
    title:'Festival', location:'Las Vegas', description:'Full day',
    date:'2026-12-31', allDay:true,
  }));
  assert.equal(url.searchParams.get('dates'), '20261231/20270101');
});
