import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentWhatsAppUrl } from '../apps/web/lib/booking-presentation.ts';

describe('public booking confirmation presentation',()=>{
  it('builds a payment WhatsApp link with server booking details and configured manager number',()=>{
    const url=new URL(createPaymentWhatsAppUrl('+62 (812) 3456-7890',{booking_code:'BK-20261009-0001',customer_name:'Guest Person',domain:'BRT',start_date:'2026-10-20',end_date:'2026-10-22',total_amount:75000,items:[{name:'Kendang',quantity:3}]}));
    assert.equal(url.hostname,'wa.me');assert.equal(url.pathname,'/6281234567890');const message=url.searchParams.get('text')!;assert.match(message,/BK-20261009-0001/);assert.match(message,/Guest Person/);assert.match(message,/Kendang/);assert.match(message,/2026-10-20 sampai 2026-10-22/);assert.match(message,/3 unit/);assert.match(message,/75\.000/);
  });
});
