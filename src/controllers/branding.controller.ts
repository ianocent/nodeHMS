import { prisma } from '../config/prisma';
import { Request, Response } from 'express';
import { error } from '../utils/response';
import { storedImageUrl } from '../utils/storage';

/**
 * GET /middleware/branding/banners — public.
 *
 * The HMS login screen (frontend-node/components/common/layout/components/login)
 * sits in front of the authentication wall, so it cannot use the authenticated
 * `/cms/content/banner` list, and it must show every property rather than the one
 * the (not yet known) user belongs to. This returns each active banner of each
 * active property, which is the artwork the operator already uploads in
 * Booking Engine Setup > Banner.
 *
 * Deliberately NOT reusing /middleware/loyalty/properties: that endpoint answers
 * `hero_image` (only the FIRST active banner per property), so a login slideshow
 * built on it would show 7 photos out of the 22 available.
 */
export async function brandingBanners(_req: Request, res: Response): Promise<void> {
  try {
    const rows: any[] = await prisma.$queryRaw`
      select cb.id,
             cb.property_id,
             p.name  as property_name,
             p.slug  as property_slug,
             cb.name,
             cb.image,
             cb.url
        from content_banners cb
        join properties p on p.id = cb.property_id
       where cb.deleted_at is null
         and cb.status = 1
         and p.deleted_at is null
         and p.status = 1
         and cb.image is not null
         and cb.image <> ''
       order by cb.property_id asc, cb.id asc
    `;

    const banners = rows
      // A banner whose image is an inline data-URI (properties.logo/.image hold
      // those on several rows) has no /storage path, so it cannot be used as a
      // background. Dropping it here beats handing the client an unrenderable src.
      .map((b) => ({
        id: String(b.id),
        property_id: String(b.property_id),
        property_name: b.property_name ?? null,
        property_slug: b.property_slug ?? null,
        name: b.name ?? null,
        url: b.url ?? null,
        image: storedImageUrl(b.image),
      }))
      .filter((b) => b.image !== null);

    res.json({ code: '200', message: 'Success', data: banners });
  } catch (err: any) {
    console.error('Branding banners error:', err);
    error(res, 'Failed to load banners', 500);
  }
}
