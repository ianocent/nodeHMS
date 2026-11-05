jest.mock('../config/queue', () => ({
  enqueueJob: jest.fn(),
}));

jest.mock('../config/prisma', () => ({
  prisma: {},
}));

import { resolveEffectiveRoomAssignment } from '../controllers/reservation.controller';

describe('resolveEffectiveRoomAssignment', () => {
  it('prefers current room id when present, otherwise falls back to the pending next-room assignment', () => {
    const row = {
      room_id: null,
      room_id_next: 42n,
      room_type_id: null,
      room_type_id_next: 7n,
    };

    expect(resolveEffectiveRoomAssignment(row)).toEqual({
      roomId: 42n,
      roomTypeId: 7n,
      roomIdNext: 42n,
      roomTypeIdNext: 7n,
    });
  });

  it('keeps the real room assignment when both current and next ids are present', () => {
    const row = {
      room_id: 11n,
      room_id_next: 42n,
      room_type_id: 3n,
      room_type_id_next: 7n,
    };

    expect(resolveEffectiveRoomAssignment(row)).toEqual({
      roomId: 11n,
      roomTypeId: 3n,
      roomIdNext: 42n,
      roomTypeIdNext: 7n,
    });
  });
});
