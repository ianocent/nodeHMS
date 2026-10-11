import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { PdfService } from '../services/pdf.service';

export class PdfController {
  static async renderPdf(req: Request, res: Response): Promise<void> {
    try {
      const { type, id } = req.params;

      // `req.params.id` is typed `string | string[]` (a wildcard route can capture an
      // array), and `BigInt(string[])` is not a thing. Reject anything non-numeric with a
      // 400 rather than letting `BigInt` throw a raw `SyntaxError` into the 500 handler.
      const rawId = Array.isArray(id) ? id[0] : id;
      if (!/^\d+$/.test(String(rawId ?? ''))) {
        res.status(400).send('Invalid id');
        return;
      }
      const folioId = BigInt(String(rawId));

      if (type === 'guest-folio') {
        return await PdfController.renderGuestFolio(req, res, folioId);
      }
      
      if (type === 'accommodation-confirmation') {
        return await PdfController.renderAccommodationConfirmation(req, res, folioId);
      }

      res.status(404).send('PDF Type not supported yet');
    } catch (err: any) {
      console.error('PDF Generation Error:', err);
      res.status(500).send('Error generating PDF');
    }
  }

  private static async renderGuestFolio(req: Request, res: Response, folioId: bigint): Promise<void> {
    // 1. Efficient Data Fetching via Prisma
    const folio = await prisma.folios.findUnique({
      where: { id: folioId },
      include: {
        guest_profiles: true,
        reservations: {
          take: 1,
          orderBy: { date: 'asc' },
          include: {
            rooms: true
          }
        },
        properties: true,
        transactions: {
          include: {
            // `transactions` has a `type_payments` relation but no `code_posts` one — the
            // ledger row carries `code` and `code_name` as plain columns instead. Asking
            // for `code_posts` was a Prisma `Unknown field` that failed the whole query.
            type_payments: true
          },
          orderBy: { date: 'asc' }
        }
      }
    });

    if (!folio) {
      res.status(404).send('Folio Not Found');
      return;
    }

    // 2. Data mapping similar to Laravel's GuestFolioReportController
    const property = folio.properties;
    const transactions = folio.transactions;
    
    // Calculate total amount natively in node
    const totalAmount = transactions.reduce((sum, tx) => {
      const val = Number(tx.total || 0);
      return tx.type_amount === 'MINUS' ? sum - val : sum + val;
    }, 0);

    const guest = folio.guest_profiles;
    const billToName = guest ? `${guest.first_name || ''} ${guest.last_name || ''}`.trim() : '';

    const data = {
      logoBase64: '', // Optionally load from S3 or local storage
      billTo: billToName,
      tel: guest?.telp || '',
      email: guest?.email || '',
      numberOfPerson: Number(folio.reservations?.[0]?.adult || 0) + Number(folio.reservations?.[0]?.child || 0),
      fax: guest?.fax || '',
      // `folios` has no voucher column (nor is it `voucher_no`). If a voucher number is
      // ever needed here it comes from the booking/reference, not the folio — left blank
      // rather than reading a field that does not exist.
      voucherNo: '',
      // `guest_profiles` has no title column at all (no `title`, no `guest_title_id`).
      // The template prints whatever this is, so it stays an empty string rather than
      // inventing a value from an unrelated field.
      title: '',
      guest: billToName,
      folioNo: folio.folio_number,
      arrival: folio.check_in_date ? new Date(folio.check_in_date).toLocaleDateString('en-GB') : '',
      departure: folio.check_out_date ? new Date(folio.check_out_date).toLocaleDateString('en-GB') : '',
      room: folio.reservations?.[0]?.rooms?.name || '',
      transactions: transactions.map(t => ({
        date: t.date ? new Date(t.date).toLocaleDateString('en-GB') : '',
        // `code_name` is the ledger's own label for the posting; fall back to the payment
        // type only when it is empty.
        description: t.code_name || t.type_payments?.name || '',
        remark: t.remark || '',
        debit: t.type_amount === 'PLUS' ? Number(t.total).toFixed(2) : '',
        credit: t.type_amount === 'MINUS' ? Number(t.total).toFixed(2) : ''
      })),
      totalAmount: totalAmount.toFixed(2),
      balance: totalAmount.toFixed(2),
      reportTitle: 'Guest Folio',
      hotelName: property?.name || '',
      address: property?.address || '',
      // `properties` stores `telp` (BigInt), not `phone`. Stringified because the template
      // concatenates it into text and a BigInt would reach the page as-is.
      phone: property?.telp != null ? String(property.telp) : '',
      hotelTel: property?.telp != null ? String(property.telp) : '',
      isolive: false
    };

    // 3. Render PDF
    const pdfBuffer = await PdfService.generatePdf('guest-folio', { data });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="guest_folio_${folio.folio_number}.pdf"`);
    res.send(pdfBuffer);
  }

  private static async renderAccommodationConfirmation(req: Request, res: Response, folioId: bigint): Promise<void> {
    // Similar implementation for confirmation letter
    const folio = await prisma.folios.findUnique({
      where: { id: folioId },
      include: {
        guest_profiles: true,
        properties: true,
        reservations: {
          include: { rooms: true, room_types: true }
        }
      }
    });

    if (!folio) {
      res.status(404).send('Folio Not Found');
      return;
    }

    const data = {
      folioNo: folio.folio_number,
      hotelName: folio.properties?.name || '',
      guestName: folio.guest_profiles ? `${folio.guest_profiles.first_name} ${folio.guest_profiles.last_name}` : '',
      checkIn: folio.check_in_date,
      checkOut: folio.check_out_date,
      // Map other necessary fields
    };

    const pdfBuffer = await PdfService.generatePdf('accommodation-confirmation', { data });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="confirmation_${folio.folio_number}.pdf"`);
    res.send(pdfBuffer);
  }
}
