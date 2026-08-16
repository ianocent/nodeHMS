import { initializeApp, App, getApp, cert } from 'firebase-admin/app';
import { getMessaging, Message, MulticastMessage, Messaging } from 'firebase-admin/messaging';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let firebaseApp: App | null = null;

function getFirebaseApp(): App {
  if (!firebaseApp) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firebase credentials not configured (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)');
    }

    try {
      firebaseApp = getApp();
    } catch {
      firebaseApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    }
  }
  return firebaseApp;
}

function getMessagingInstance(): Messaging {
  const app = getFirebaseApp();
  return getMessaging(app);
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

export interface SendToUserOptions {
  userId: bigint;
  payload: PushNotificationPayload;
}

export interface SendToTokenOptions {
  token: string;
  payload: PushNotificationPayload;
}

export interface SendToTopicOptions {
  topic: string;
  payload: PushNotificationPayload;
}

export class FirebaseService {
  async sendToUser({ userId, payload }: SendToUserOptions): Promise<{ success: boolean; results: number }> {
    try {
      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: { fcm_token: true },
      });

      if (!user?.fcm_token) {
        console.warn(`[Firebase] User ${userId} has no FCM token`);
        return { success: false, results: 0 };
      }

      const result = await this.sendToToken({ token: user.fcm_token, payload });
      return result;
    } catch (err: any) {
      console.error('[Firebase] sendToUser error:', err);
      return { success: false, results: 0 };
    }
  }

  async sendToToken({ token, payload }: SendToTokenOptions): Promise<{ success: boolean; results: number }> {
    try {
      const message: Message = {
        token,
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data ? Object.fromEntries(
          Object.entries(payload.data).map(([k, v]) => [k, String(v)])
        ) : undefined,
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response = await getMessagingInstance().send(message);
      console.log(`[Firebase] Push sent: ${response}`);
      return { success: true, results: 1 };
    } catch (err: any) {
      if (err.code === 'messaging/registration-token-not-registered') {
        console.warn(`[Firebase] Token invalid/expired: ${token.substring(0, 20)}...`);
      } else {
        console.error('[Firebase] sendToToken error:', err);
      }
      return { success: false, results: 0 };
    }
  }

  async sendToMultipleTokens(tokens: string[], payload: PushNotificationPayload): Promise<{ success: number; failed: number }> {
    if (!tokens.length) return { success: 0, failed: 0 };

    try {
      const message: MulticastMessage = {
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data ? Object.fromEntries(
          Object.entries(payload.data).map(([k, v]) => [k, String(v)])
        ) : undefined,
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response = await getMessagingInstance().sendEachForMulticast(message);
      console.log(`[Firebase] Multicast sent: ${response.successCount} success, ${response.failureCount} failed`);
      return { success: response.successCount, failed: response.failureCount };
    } catch (err: any) {
      console.error('[Firebase] sendToMultipleTokens error:', err);
      return { success: 0, failed: tokens.length };
    }
  }

  async sendToTopic({ topic, payload }: SendToTopicOptions): Promise<{ success: boolean; messageId?: string }> {
    try {
      const message: Message = {
        topic,
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data ? Object.fromEntries(
          Object.entries(payload.data).map(([k, v]) => [k, String(v)])
        ) : undefined,
      };

      const messageId = await getMessagingInstance().send(message);
      console.log(`[Firebase] Topic push sent to ${topic}: ${messageId}`);
      return { success: true, messageId };
    } catch (err: any) {
      console.error('[Firebase] sendToTopic error:', err);
      return { success: false };
    }
  }

  async subscribeToTopic(tokens: string[], topic: string): Promise<{ success: number; failed: number }> {
    try {
      const response = await getMessagingInstance().subscribeToTopic(tokens, topic);
      console.log(`[Firebase] Subscribed ${response.successCount} tokens to ${topic}`);
      return { success: response.successCount, failed: response.failureCount };
    } catch (err: any) {
      console.error('[Firebase] subscribeToTopic error:', err);
      return { success: 0, failed: tokens.length };
    }
  }

  async unsubscribeFromTopic(tokens: string[], topic: string): Promise<{ success: number; failed: number }> {
    try {
      const response = await getMessagingInstance().unsubscribeFromTopic(tokens, topic);
      console.log(`[Firebase] Unsubscribed ${response.successCount} tokens from ${topic}`);
      return { success: response.successCount, failed: response.failureCount };
    } catch (err: any) {
      console.error('[Firebase] unsubscribeFromTopic error:', err);
      return { success: 0, failed: tokens.length };
    }
  }
}

export const firebaseService = new FirebaseService();