import { Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { success, error, badRequest } from '../utils/response';
import { firebaseService } from '../services/firebase.service';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export class FirebaseController {
  // Test send to current user
  static async testPush(req: Request, res: Response): Promise<void> {
    try {
      const { title, body, data } = req.body;
      const userId = req.user!.id;

      const result = await firebaseService.sendToUser({
        userId,
        payload: {
          title: title || 'Test Notification',
          body: body || 'This is a test push from HMS Anyaman',
          data: data || { test: 'true', timestamp: new Date().toISOString() },
        },
      });

      if (result.success) {
        success(res, { sent: result.results }, 'Test push sent');
      } else {
        error(res, 'Failed to send push (no FCM token or token invalid)', 400);
      }
    } catch (err: any) {
      console.error('[FirebaseController] testPush error:', err);
      error(res, 'Failed to send test push: ' + err.message, 500);
    }
  }

  // Send to specific user by ID (admin)
  static async sendToUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId, title, body, data } = req.body;
      if (!userId || !title || !body) {
        badRequest(res, 'userId, title, body required');
        return;
      }

      const result = await firebaseService.sendToUser({
        userId: BigInt(userId),
        payload: { title, body, data },
      });

      if (result.success) {
        success(res, { sent: result.results }, 'Push sent to user');
      } else {
        error(res, 'Failed to send push to user', 400);
      }
    } catch (err: any) {
      console.error('[FirebaseController] sendToUser error:', err);
      error(res, 'Failed to send push: ' + err.message, 500);
    }
  }

  // Send to multiple users
  static async sendToUsers(req: Request, res: Response): Promise<void> {
    try {
      const { userIds, title, body, data } = req.body;
      if (!userIds || !Array.isArray(userIds) || !userIds.length || !title || !body) {
        badRequest(res, 'userIds (array), title, body required');
        return;
      }

      // Get FCM tokens for all users
      const users = await prisma.users.findMany({
        where: { id: { in: userIds.map((id: string) => BigInt(id)) } },
        select: { id: true, fcm_token: true },
      });

      const tokens = users.filter(u => u.fcm_token).map(u => u.fcm_token!);
      if (!tokens.length) {
        error(res, 'No valid FCM tokens found for users', 400);
        return;
      }

      const result = await firebaseService.sendToMultipleTokens(tokens, { title, body, data });
      success(res, { success: result.success, failed: result.failed }, 'Multicast push completed');
    } catch (err: any) {
      console.error('[FirebaseController] sendToUsers error:', err);
      error(res, 'Failed to send multicast push: ' + err.message, 500);
    }
  }

  // Send to topic (e.g., "all-staff", "front-desk", "housekeeping")
  static async sendToTopic(req: Request, res: Response): Promise<void> {
    try {
      const { topic, title, body, data } = req.body;
      if (!topic || !title || !body) {
        badRequest(res, 'topic, title, body required');
        return;
      }

      const result = await firebaseService.sendToTopic({ topic, payload: { title, body, data } });
      if (result.success) {
        success(res, { messageId: result.messageId }, `Push sent to topic: ${topic}`);
      } else {
        error(res, 'Failed to send push to topic', 500);
      }
    } catch (err: any) {
      console.error('[FirebaseController] sendToTopic error:', err);
      error(res, 'Failed to send topic push: ' + err.message, 500);
    }
  }

  // Subscribe user tokens to topic
  static async subscribeTopic(req: Request, res: Response): Promise<void> {
    try {
      const { userIds, topic } = req.body;
      if (!userIds || !Array.isArray(userIds) || !topic) {
        badRequest(res, 'userIds (array), topic required');
        return;
      }

      const users = await prisma.users.findMany({
        where: { id: { in: userIds.map((id: string) => BigInt(id)) } },
        select: { fcm_token: true },
      });

      const tokens = users.filter(u => u.fcm_token).map(u => u.fcm_token!);
      if (!tokens.length) {
        error(res, 'No valid FCM tokens', 400);
        return;
      }

      const result = await firebaseService.subscribeToTopic(tokens, topic);
      success(res, { success: result.success, failed: result.failed }, `Subscribed to ${topic}`);
    } catch (err: any) {
      console.error('[FirebaseController] subscribeTopic error:', err);
      error(res, 'Failed to subscribe: ' + err.message, 500);
    }
  }

  // Unsubscribe user tokens from topic
  static async unsubscribeTopic(req: Request, res: Response): Promise<void> {
    try {
      const { userIds, topic } = req.body;
      if (!userIds || !Array.isArray(userIds) || !topic) {
        badRequest(res, 'userIds (array), topic required');
        return;
      }

      const users = await prisma.users.findMany({
        where: { id: { in: userIds.map((id: string) => BigInt(id)) } },
        select: { fcm_token: true },
      });

      const tokens = users.filter(u => u.fcm_token).map(u => u.fcm_token!);
      if (!tokens.length) {
        error(res, 'No valid FCM tokens', 400);
        return;
      }

      const result = await firebaseService.unsubscribeFromTopic(tokens, topic);
      success(res, { success: result.success, failed: result.failed }, `Unsubscribed from ${topic}`);
    } catch (err: any) {
      console.error('[FirebaseController] unsubscribeTopic error:', err);
      error(res, 'Failed to unsubscribe: ' + err.message, 500);
    }
  }

  // Save FCM token (alias for admin.saveFcmToken)
  static async saveToken(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.body;
      if (!token) {
        badRequest(res, 'token required');
        return;
      }

      await prisma.users.update({ where: { id: req.user!.id }, data: { fcm_token: token } });
      success(res, null, 'FCM token saved');
    } catch (err: any) {
      console.error('[FirebaseController] saveToken error:', err);
      error(res, 'Failed to save FCM token', 500);
    }
  }
}

// Express router factory
import { Router } from 'express';

export const firebaseRoutes = Router();

firebaseRoutes.post('/firebase/test-push', authMiddleware, FirebaseController.testPush);
firebaseRoutes.post('/firebase/send-user', authMiddleware, requirePermission(69, 'edit'), FirebaseController.sendToUser);
firebaseRoutes.post('/firebase/send-users', authMiddleware, requirePermission(69, 'edit'), FirebaseController.sendToUsers);
firebaseRoutes.post('/firebase/send-topic', authMiddleware, requirePermission(69, 'edit'), FirebaseController.sendToTopic);
firebaseRoutes.post('/firebase/subscribe', authMiddleware, requirePermission(69, 'edit'), FirebaseController.subscribeTopic);
firebaseRoutes.post('/firebase/unsubscribe', authMiddleware, requirePermission(69, 'edit'), FirebaseController.unsubscribeTopic);
firebaseRoutes.post('/firebase/save-token', authMiddleware, FirebaseController.saveToken);