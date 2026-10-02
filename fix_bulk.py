import sys

path = "C:/Users/uzuma/Documents/hms-anyaman/backend-node/src/controllers/reservation.controller.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

target = """      // Partial success still returns 200 with the breakdown — the old handler
      // reported `updated: ids.length` regardless of what actually happened.
      success(res, {"""

replacement = """      enqueueJob('sync-staah-room-availability', { propertyId: Number(req.user?.lastProperty ?? 0) });
      // Partial success still returns 200 with the breakdown — the old handler
      // reported `updated: ids.length` regardless of what actually happened.
      success(res, {"""

if target in content:
    content = content.replace(target, replacement)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Success")
else:
    print("Target not found")
