import { Request, Response } from 'express';
import { PdfService } from '../../services/pdf.service';

// Property → template variant.
//
// IDs 1002/1003 are what the Laravel base checks (PreRegistrationController.php:30,
// GuestFolioReportController.php:70, GuestInvoiceController.php:26,
// OfficialReceiptController.php:24, AccommodationConfirmationFOController.php:576),
// so keep them. The other variants must be matched by NAME, not ID: the original map
// here assumed 1001=Anyaman / 1004=Kuretakeso / 1005=BaliBagus, but `properties` in the
// live DB is 999=KURETAKESO, 1000=Anyaman, 1001=Bali Bagus Lovina, 1004=Shangri-La,
// 1005=asialink. Every property therefore resolved to the plain template, which is a
// broken template — that is what turned every folio PDF into a 500.
const PROPERTY_TEMPLATE_VARIANTS: { names: string[]; suffix: string }[] = [
    { names: ['HOTEL OLIVE', 'Ow! Hotel'], suffix: '-olive' },
    { names: ['KURETAKESO'], suffix: '-kuretakeso' },
    { names: ['Anyaman'], suffix: '-anyaman' },
    { names: ['Bali Bagus Lovina', 'BaliBagus'], suffix: '-bali-bagus' },
];

export async function renderEjsPdf(documentType: string, ctx: any): Promise<Buffer> {
    const pid = ctx.property?.id;
    const propertyName = String(ctx.property?.name ?? '').trim();
    const isOlive = pid === 1002n || pid === 1003n;
    const suffix = PROPERTY_TEMPLATE_VARIANTS.find(
        (v) => v.names.some((n) => n.toLowerCase() === propertyName.toLowerCase()),
    )?.suffix;

    let templateName = documentType;
    if (documentType === 'confirmation') templateName = 'accommodation-confirmation';
    if (documentType === 'letter-of-agreement') templateName = 'accommodation-confirmation-group'; // Best guess

    if (['pre-registration', 'registration-form'].includes(documentType)) {
        // Only the Olive variant is a standalone template; the anyaman/bali-bagus/
        // kuretakeso variants live under `partials/`. `registration-form` maps to the
        // `registration-*` partials, which is why the stem differs by property.
        const stem = documentType === 'registration-form' ? 'registration' : 'pre-registration';
        templateName = isOlive
            ? `${documentType}-olive`
            : suffix
                ? `partials/${stem}${suffix}`
                : documentType;
    } else if (
        ['guest-folio', 'guest-invoice', 'proforma-invoice', 'official-receipt', 'accommodation-confirmation'].includes(templateName)
    ) {
        if (isOlive) templateName += '-olive';
    }

    let totalDebit = 0;
    let totalCredit = 0;
    ctx.transactions.forEach((t: any) => {
        if (t.type_amount !== 'MINUS') totalDebit += Number(t.total ?? 0);
        else totalCredit += Number(t.total ?? 0);
    });

    // Formatting date helper for EJS
    const formatDate = (d: any) => d ? new Date(d).toLocaleDateString('en-GB') : '-';

    const ejsData = {
        logoBase64: ctx.property?.logo ?? '',
        hotelName: ctx.property?.name ?? '',
        hotelAddress: ctx.property?.address ?? '',
        hotelTel: ctx.property?.phone ?? '',
        hotelEmail: ctx.property?.email ?? '',
        address: ctx.property?.address ?? '',
        phone: ctx.property?.phone ?? '',
        email: ctx.property?.email ?? '',
        
        billTo: ctx.company?.name ?? `${ctx.guest?.first_name ?? ctx.folio.first_name ?? ''} ${ctx.guest?.last_name ?? ctx.folio.last_name ?? ''}`.trim(),
        guest: `${ctx.guest?.first_name ?? ctx.folio.first_name ?? ''} ${ctx.guest?.last_name ?? ctx.folio.last_name ?? ''}`.trim(),
        company: ctx.company?.name ?? ctx.folio.company_name ?? '-',
        
        tel: ctx.guest?.telp ?? ctx.guest?.mobile_phone ?? '-',
        fax: ctx.company?.fax ?? '-',
        folioNo: ctx.folio.folio_number ?? '-',
        voucherNo: ctx.folio.voucher_no ?? '-',
        
        arrival: formatDate(ctx.folio.check_in_date),
        departure: formatDate(ctx.folio.check_out_date),
        
        room: ctx.reservations.map((r: any) => r.rooms?.name).filter(Boolean).join(', ') || (ctx.folio.reservations?.[0]?.room_name ?? '-'),
        numberOfPerson: ctx.reservations.reduce((max: number, r: any) => Math.max(max, Number(r.adult ?? 0) + Number(r.child ?? 0)), 0),
        
        transactions: ctx.transactions.map((t: any) => ({
            ...t,
            date: formatDate(t.date),
            description: t.code_posts?.name ?? t.code_name ?? t.description ?? '',
            debit: t.type_amount !== 'MINUS' ? t.total : '',
            credit: t.type_amount === 'MINUS' ? t.total : '',
            codePost: t.code_posts,
        })),
        
        reservations: ctx.reservations.map((r: any) => ({
            ...r,
            checkIn: formatDate(r.check_in_date),
            checkOut: formatDate(r.check_out_date),
            roomType: r.room_types?.name,
            roomName: r.rooms?.name,
            rateName: r.rates?.name ?? r.rate_name,
        })),

        inclusives: Array.from(ctx.inclusivesByReservation.values()).flat(),
        
        totalAmount: totalDebit,
        balance: totalDebit - totalCredit,
        totalDebit,
        totalCredit,
    };

    return await PdfService.generatePdf(templateName, ejsData);
}
