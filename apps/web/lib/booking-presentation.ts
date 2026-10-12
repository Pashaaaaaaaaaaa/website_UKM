export type BookingConfirmation = {
  booking_code: string;
  customer_name: string;
  domain: 'DANCE' | 'BRT';
  start_date: string;
  end_date: string;
  total_amount: number;
  items: Array<{name:string;quantity:number}>;
};

export function createPaymentWhatsAppUrl(managerNumber:string|null,booking:BookingConfirmation):string {
  const item=booking.items[0];
  const phone=managerNumber?.replace(/\D/g,'')??'';
  const message=[
    `Halo, saya ${booking.customer_name}. Saya ingin bertanya tentang pembayaran booking ${booking.booking_code}.`,
    `Layanan: ${item?.name??(booking.domain==='DANCE'?'Pertunjukan tari':'Perlengkapan BRT')}`,
    `Tanggal: ${booking.start_date} sampai ${booking.end_date}`,
    `Jumlah: ${booking.domain==='DANCE'?'1 pertunjukan':`${item?.quantity??1} unit`}`,
    `Total: Rp ${booking.total_amount.toLocaleString('id-ID')}`,
  ].join('\n');
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
