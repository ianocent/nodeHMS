import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Sanctum-compatible token service.
 * Laravel Sanctum generates: {db_id}|{random40chars}
 * Stored as SHA-256 hash of the random part.
 */
export class TokenService {
  /**
   * Create a new Sanctum-style personal access token.
   * Returns the plainTextToken (sent to client).
   */
  static async createToken(
    userId: bigint,
    name: string,
    abilities: string[] = []
  ): Promise<{
    plainTextToken: string;
    createdAt: Date;
  }> {
    // Generate 40 random bytes → base64 → strip padding → first 40 chars
    const randomBytes = crypto.randomBytes(40);
    const plainText = randomBytes.toString('base64').replace(/[+/=]/g, '').substring(0, 40);

    // Hash with SHA-256 (matches Laravel's hash('sha256', $token))
    const hashedToken = crypto.createHash('sha256').update(plainText).digest('hex');

    // Expiration: 24 hours from now (matching Sanctum config)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Create DB record
    const record = await prisma.personal_access_tokens.create({
      data: {
        tokenable_type: 'App\\Models\\User',
        tokenable_id: userId,
        name,
        token: hashedToken,
        abilities: abilities.length > 0 ? JSON.stringify(abilities) : null,
        expires_at: expiresAt,
        last_used_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // Return Sanctum format: "id|plainText" + created_at (Laravel uses
    // token created_at as expires_token in the login response)
    return {
      plainTextToken: `${record.id}|${plainText}`,
      createdAt: record.created_at ?? new Date(),
    };
  }

  /**
   * Revoke a specific token by its DB id.
   */
  static async revokeToken(tokenId: bigint): Promise<void> {
    await prisma.personal_access_tokens.delete({
      where: { id: tokenId },
    });
  }

  /**
   * Revoke ALL tokens for a user (matches Laravel logout behavior).
   */
  static async revokeAllUserTokens(userId: bigint): Promise<void> {
    await prisma.personal_access_tokens.deleteMany({
      where: {
        tokenable_type: 'App\\Models\\User',
        tokenable_id: userId,
      },
    });
  }

  /**
   * Find a token record by plainTextToken string.
   */
  static async findToken(plainTextToken: string) {
    const parts = plainTextToken.split('|');
    if (parts.length !== 2) return null;

    const tokenId = parts[0];
    const plainText = parts[1];
    const hashedToken = crypto.createHash('sha256').update(plainText).digest('hex');

    return prisma.personal_access_tokens.findFirst({
      where: {
        id: BigInt(tokenId),
        token: hashedToken,
      },
    });
  }

  /**
   * Check if user has active token (used within last 30 minutes).
   * Replicates Laravel's single-session enforcement.
   */
  static async hasActiveSession(userId: bigint): Promise<boolean> {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const count = await prisma.personal_access_tokens.count({
      where: {
        tokenable_type: 'App\\Models\\User',
        tokenable_id: userId,
        last_used_at: { gte: thirtyMinAgo },
      },
    });
    return count > 0;
  }

  /**
   * Clear FCM token for a user (like Laravel logout).
   */
  static async clearFcmToken(userId: bigint): Promise<void> {
    await prisma.users.update({
      where: { id: userId },
      data: { fcm_token: null },
    });
  }
}
