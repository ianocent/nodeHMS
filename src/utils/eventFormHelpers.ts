export function generateEventForm(
  data: any,
  packages: any[],
  venues: any[],
  layouts: any[]
) {
  const isEdit = !!data;
  const eventId = data?.id;

  // The Event Items / Instructions / Deposit tabs read rows scoped to one saved
  // event, so they only make sense once the event has an id. On create we still
  // emit the steps (the tab strip is a fixed list of four labels) but swap the
  // tables for a note, otherwise the table would fetch an id that does not exist.
  const subStep = (name: string, tables: { uri: string; col?: string }[]) => ({
    name,
    input: isEdit
      ? tables.map((t, i) => ({ type: 'table', name: `${name.toLowerCase().replace(/\s+/g, '_')}_${i}`, label: '', uri: t.uri, col: t.col ?? 'col-span-12' }))
      : [
          {
            type: 'readonly',
            name: `${name.toLowerCase().replace(/\s+/g, '_')}_hint`,
            label: name,
            value: `Save this event first, then return to <strong>${name}</strong> to manage its rows.`,
            col: 'col-span-12',
          },
        ],
  });

  return {
    action: isEdit ? `/cms/event-list/${data.id}` : '/cms/event-list',
    isFormData: false,
    list: [
      {
        lang: 'Detail Event',
        step: [
          {
            name: 'Event Detail',
            input: [
              { type: 'text', name: 'name', label: 'Event Name', value: data?.name || '', placeholder: 'Enter Event Name', mandatory: true, col: 'col-span-4' },
              { type: 'datetime-local', name: 'event_start_time', label: 'Start Date & Time', value: data?.event_start_time ? new Date(data.event_start_time).toISOString().slice(0, 16) : '', placeholder: 'Select Start Time', mandatory: true, col: 'col-span-4' },
              { type: 'datetime-local', name: 'event_end_time', label: 'End Date & Time', value: data?.event_end_time ? new Date(data.event_end_time).toISOString().slice(0, 16) : '', placeholder: 'Select End Time', mandatory: true, col: 'col-span-4' },
              { type: 'text', name: 'guest_name', label: 'Guest Name', value: data?.guest_name || '', placeholder: 'Enter Guest Name', mandatory: true, col: 'col-span-4' },
              { type: 'text', name: 'guest_phone', label: 'Guest Phone', value: data?.guest_phone || '', placeholder: 'Enter Guest Phone', mandatory: true, col: 'col-span-4' },
              { type: 'text', name: 'guest_email', label: 'Guest Email', value: data?.guest_email || '', placeholder: 'Enter Guest Email', mandatory: true, col: 'col-span-4' },
              { type: 'autocomplete', name: 'company_profile_id', label: 'Company Profile', value: data?.company_profile_id ? { value: Number(data.company_profile_id), label: data.company_profiles?.name || 'Company' } : null, uriAutoComplete: '/cms/profile/company-v2', placeholder: 'Select Company Profile', mandatory: true, col: 'col-span-4' },
              { type: 'autocomplete', name: 'sales_in_charge', label: 'Sales In Charge', value: data?.sales_in_charge ? { value: Number(data.sales_in_charge), label: 'Sales' } : null, uriAutoComplete: '/cms/event-list/get-sales-in-charge', placeholder: 'Enter Sales In Charge', mandatory: true, col: 'col-span-4' },
              { type: 'select', name: 'package_id', label: 'Package', value: data?.package_id ? { value: Number(data.package_id), label: packages.find(p => p.id == data.package_id)?.name } : null, options: packages.map(p => ({ value: Number(p.id), label: p.name })), placeholder: 'Select Package', mandatory: true, col: 'col-span-4' },
              { type: 'select', name: 'venue_id', label: 'Venue', value: data?.venue_id ? { value: Number(data.venue_id), label: venues.find(v => v.id == data.venue_id)?.name } : null, options: venues.map(v => ({ value: Number(v.id), label: v.name })), placeholder: 'Select Venue', mandatory: true, col: 'col-span-4' },
              { type: 'select', name: 'layout_id', label: 'Layout', value: data?.layout_id ? { value: Number(data.layout_id), label: layouts.find(l => l.id == data.layout_id)?.name } : null, options: layouts.map(l => ({ value: Number(l.id), label: l.name })), placeholder: 'Select Layout', mandatory: true, col: 'col-span-4' },
              { type: 'number', name: 'pax', label: 'PAX', value: data?.pax || '', placeholder: 'Enter PAX', mandatory: true, col: 'col-span-4' },
              { type: 'autocomplete', name: 'folio_id', label: 'Reservation No', value: data?.folio_id ? { value: Number(data.folio_id), label: `Folio ${data.folio_id}` } : null, uriAutoComplete: '/cms/event-list/folio', placeholder: 'Enter Reservation No', mandatory: false, col: 'col-span-4' },
              { type: 'select', name: 'status', label: 'Status', value: data?.status ? { value: data.status, label: data.status } : null, options: ['Tentative', 'Canceled', 'To Be Announced', 'Definitely', 'Fix'].map(s => ({ value: s, label: s })), placeholder: 'Select Status', mandatory: true, col: 'col-span-4' },
              { type: 'number', name: 'total_amount', label: 'Total Amount', value: data?.total_amount || 0, placeholder: 'Enter Total Amount', mandatory: true, col: 'col-span-4' },
              { type: 'textarea', name: 'description', label: 'Description', value: data?.description || '', placeholder: 'Enter Description', mandatory: false, col: 'col-span-12' },
            ]
          },
          subStep('Event Items', [{ uri: `/cms/event/${eventId}/items` }]),
          subStep('Event Instructions', [{ uri: `/cms/event/${eventId}/instructions` }]),
          subStep('Event Deposit', [
            { uri: `/cms/event/${eventId}/deposit-plans` },
            { uri: `/cms/event/${eventId}/deposit-actuals` },
          ]),
        ]
      }
    ]
  };
}

export function generatePackageForm(
  data: any,
  venues: any[],
  layouts: any[],
  capacities: any[]
) {
  const isEdit = !!data;
  return {
    action: isEdit ? `/cms/event-package/${data.id}` : '/cms/event-package',
    isFormData: false,
    list: [
      {
        lang: 'Package Detail',
        step: [
          {
            name: 'Detail',
            input: [
              { type: 'text', name: 'name', label: 'Name', value: data?.name || '', mandatory: true, col: 'col-span-6' },
              { type: 'select', name: 'capacity_id', label: 'Capacity', value: data?.capacity_id ? { value: Number(data.capacity_id), label: capacities.find(c => c.id == data.capacity_id) ? (capacities.find(c => c.id == data.capacity_id)?.description || `${capacities.find(c => c.id == data.capacity_id)?.pax} PAX`) : '' } : null, options: capacities.map(c => ({ value: Number(c.id), label: c.description || `${c.pax} PAX` })), mandatory: true, col: 'col-span-6' },
              { type: 'number', name: 'max_capacity', label: 'Max Capacity', value: data?.max_capacity || '', mandatory: true, col: 'col-span-6' },
              { type: 'select', name: 'venue_id', label: 'Venue', value: data?.venue_id ? { value: Number(data.venue_id), label: venues.find(v => v.id == data.venue_id)?.name } : null, options: venues.map(v => ({ value: Number(v.id), label: v.name })), mandatory: true, col: 'col-span-6' },
              { type: 'select', name: 'layout_id', label: 'Layout', value: data?.layout_id ? { value: Number(data.layout_id), label: layouts.find(l => l.id == data.layout_id)?.name } : null, options: layouts.map(l => ({ value: Number(l.id), label: l.name })), mandatory: true, col: 'col-span-6' },
              { type: 'number', name: 'price', label: 'Price', value: data?.price || 0, mandatory: true, col: 'col-span-6' },
              { type: 'select', name: 'status', label: 'Status', value: data?.status !== undefined ? { value: data.status, label: data.status ? 'Active' : 'Inactive' } : { value: true, label: 'Active' }, options: [{value: true, label: 'Active'}, {value: false, label: 'Inactive'}], mandatory: true, col: 'col-span-6' },
              { type: 'textarea', name: 'description', label: 'Description', value: data?.description || '', mandatory: false, col: 'col-span-12' },
            ]
          }
        ]
      }
    ]
  };
}
