import { Response } from 'express';

/**
 * SSE Notification Service
 * Manages Server-Sent Events connections per user.
 * When a task is created/updated, push to the target user's SSE stream.
 * Replaces polling at /cms/helper/task-notification.
 */
class NotificationService {
  // userId -> Set of open SSE connections
  private clients: Map<bigint, Set<Response>> = new Map();

  /** Register an SSE connection for a user */
  subscribe(userId: bigint, res: Response): void {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx proxy bypass
    res.flushHeaders();

    // Send initial keepalive comment
    res.write(':ok\n\n');

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      try { res.write(':ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 30000);

    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(res);

    // Cleanup on disconnect
    res.on('close', () => {
      clearInterval(heartbeat);
      const set = this.clients.get(userId);
      if (set) {
        set.delete(res);
        if (set.size === 0) this.clients.delete(userId);
      }
    });
  }

  /** Push a notification event to a specific user */
  push(userId: bigint, event: string, data: any): void {
    const set = this.clients.get(userId);
    if (!set || set.size === 0) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const dead: Response[] = [];

    for (const res of set) {
      try {
        res.write(payload);
      } catch {
        dead.push(res);
      }
    }

    // Cleanup dead connections
    for (const res of dead) {
      set.delete(res);
    }
    if (set.size === 0) this.clients.delete(userId);
  }

  /** Push to multiple users (e.g. role-based notification) */
  pushToMany(userIds: bigint[], event: string, data: any): void {
    for (const uid of userIds) {
      this.push(uid, event, data);
    }
  }

  /** Broadcast to all connected clients */
  broadcast(event: string, data: any): void {
    for (const [userId] of this.clients) {
      this.push(userId, event, data);
    }
  }

  /** Get count of connected users */
  get connectedCount(): number {
    return this.clients.size;
  }
}

// Singleton
export const notificationService = new NotificationService();
