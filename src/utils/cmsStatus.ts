// Shared CMS status maps + color helpers replicating config/cms.php and helpers/Global.php.

export const ROOM_STATUSES: Record<string, { id: number; name: string }> = {
  vacant: { id: 0, name: 'Vacant' },
  occupied: { id: 1, name: 'Occupied' },
  due_out: { id: 2, name: 'Due Out' },
  block: { id: 3, name: 'Blocked' },
  out_of_order: { id: 4, name: 'Out of Order' },
};

export const MAID_STATUSES: Record<string, { id: number; name: string }> = {
  clean: { id: 0, name: 'Clean' },
  dirty: { id: 1, name: 'Dirty' },
  maid_in_room: { id: 2, name: 'Maid in Room' },
  inspection_required: { id: 3, name: 'Inspection Required' },
};

export const STATUS_RESERVATION_MAP: Record<number, string> = {
  0: 'Check In',
  1: 'Check Out',
  2: 'Cancelled',
  3: 'Reservation',
  4: 'In House',
  5: 'Pending',
};

export function getColorRoom(status: number): string {
  switch (status) {
    case 0: return 'bg-cyan';
    case 1: return 'bg-green';
    case 2: return 'bg-purple';
    case 3: return 'bg-red';
    case 4: return 'bg-black-red';
    default: return 'bg-success';
  }
}

export function getColorCodeRoom(status: number): string {
  switch (status) {
    case 0: return '#22d3ee';
    case 1: return '#10b981';
    case 2: return '#f59e0b';
    case 3: return '#ef4444';
    case 4: return '#8b5cf6';
    default: return '#198754';
  }
}

export function getColorMaid(status: number): string {
  switch (status) {
    case 0: return 'bg-cyan';
    case 1: return 'bg-red';
    case 2: return 'bg-yellow';
    case 3: return 'bg-green';
    default: return 'bg-success';
  }
}

export function getColorCodeMaid(status: number): string {
  switch (status) {
    case 0: return '#ffffff';
    case 1: return '#ef4444';
    case 2: return '#f59e0b';
    case 3: return '#10b981';
    default: return '#198754';
  }
}

export function getColorReservation(status: number): string {
  switch (status) {
    case 0: return 'bg-green';
    case 1: return 'bg-purple';
    case 2: return 'bg-red';
    case 3: return 'bg-cyan';
    case 4: return 'bg-blue';
    case 5: return 'bg-yellow';
    default: return 'bg-success';
  }
}

export function getColorCodeReservation(status: number): string {
  switch (status) {
    case 0: return '#10b981';
    case 1: return '#8b5cf6';
    case 2: return '#ef4444';
    case 3: return '#22d3ee';
    case 4: return '#3b82f6';
    case 5: return '#f59e0b';
    default: return '#198754';
  }
}

export function dashLabel(status: number | null | undefined, map: Record<number, string>): string {
  return ((status != null ? map[status] : '') || '').replace(/ /g, '-');
}

export function ucfirst(val: string | null | undefined): string {
  if (!val) return '';
  return val.charAt(0).toUpperCase() + val.slice(1);
}

export function folioUrl(folio: { id: bigint | number; type_reservation?: string | null } | null | undefined): string | null {
  if (!folio) return null;
  const id = folio.id;
  const time = Math.floor(Date.now() / 1000);
  if (folio.type_reservation === 'fit') {
    return '/reservation/fit/reservation?parent=62&data=' + id + '&time=' + time + '&card=0&pageload=&group=fit';
  }
  if (folio.type_reservation === 'git') {
    return '/reservation/git?parent=63&data=' + id + '&time=' + time + '&card=0&pageload=&group=git';
  }
  if (folio.type_reservation === 'vr') {
    return '/reservation/vr/reservation?parent=69&data=' + id + '&time=' + time + '&card=0&pageload=&group=vr';
  }
  return null;
}
