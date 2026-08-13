import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function bigintToNumber(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

const MENU_ID = 1102;

export class DynamicRateController {
  /**
   * GET /api/dynamic-rates
   * Paginated list of dynamic_rate_configs
   */
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const sort = req.query.sort as string || 'id';
      const order = req.query.order === 'desc' ? 'desc' : 'asc';

      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = { deleted_at: trash ? { not: null } : null };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { forecast_method: { contains: search, mode: 'insensitive' } }
        ];
      }

      const isSuperUser = req.user?.superUser || false;
      if (!isSuperUser) {
        where.property_id = req.user?.lastProperty;
      }

      const [configs, total] = await Promise.all([
        prisma.dynamic_rate_configs.findMany({
          where,
          orderBy: { [sort]: order },
          skip: (page - 1) * limit,
          take: limit
        }),
        prisma.dynamic_rate_configs.count({ where })
      ]);

      const formatted = configs.map(c => ({
        ...c,
        id: Number(c.id),
        property_id: Number(c.property_id)
      }));

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: true },
        { label: 'Forecast Method', key: 'forecast_method', type: 'badge', is_search: true },
        { label: 'Is Active', key: 'is_active', type: 'badge', is_search: true },
        { label: 'Auto Apply', key: 'auto_apply', type: 'badge', is_search: true },
        { label: 'Status', key: 'status', type: 'badge', is_search: true },
        { label: 'Action', key: 'action', type: 'action', is_search: false }
      ];

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete
      };

      const searchData = [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'forecast_method', label: 'Forecast Method', type: 'select', options: [
          { value: 'moving_average', label: 'Moving Average' },
          { value: 'exponential_smoothing', label: 'Exponential Smoothing' },
          { value: 'linear_regression', label: 'Linear Regression' },
          { value: 'seasonal_naive', label: 'Seasonal Naive' },
          { value: 'manual', label: 'Manual' }
        ]},
        { key: 'is_active', label: 'Is Active', type: 'select', options: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' }
        ]},
        { key: 'auto_apply', label: 'Auto Apply', type: 'select', options: [
          { value: 1, label: 'Yes' },
          { value: 0, label: 'No' }
        ]},
        { key: 'status', label: 'Status', type: 'select', options: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' }
        ]}
      ];

      success(res, bigintToNumber(formatted), 'Success', 200, {
        table,
        permission,
        search_data: searchData,
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total)
        }
      });
    } catch (err: any) {
      console.error('Dynamic rate list error:', err);
      error(res, 'Failed to fetch dynamic rates', 500);
    }
  }

  /**
   * GET /api/dynamic-rates/create
   * Get master data for creation form
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const master = {
        statuses: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' }
        ],
        forecast_methods: [
          { value: 'moving_average', label: 'Moving Average' },
          { value: 'exponential_smoothing', label: 'Exponential Smoothing' },
          { value: 'linear_regression', label: 'Linear Regression' },
          { value: 'seasonal_naive', label: 'Seasonal Naive' },
          { value: 'manual', label: 'Manual' }
        ]
      };

      success(res, master, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  /**
   * POST /api/dynamic-rates
   * Create new config
   */
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const {
        name, forecast_method, gdp_growth_rate, inflation_rate,
        adjustment_sensitivity, min_adjustment_percent, max_adjustment_percent,
        lookback_days, forecast_days, target_occupancy, seasonality_factors,
        is_active, auto_apply, sort, status
      } = req.body;

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The name field is required.'];
      if (!forecast_method) errors.forecast_method = ['The forecast method field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const config = await prisma.dynamic_rate_configs.create({
        data: {
          property_id: BigInt(req.user?.lastProperty!),
          name,
          forecast_method,
          gdp_growth_rate,
          inflation_rate,
          adjustment_sensitivity,
          min_adjustment_percent,
          max_adjustment_percent,
          lookback_days: lookback_days || 90,
          forecast_days: forecast_days || 30,
          target_occupancy,
          seasonality_factors: seasonality_factors || undefined,
          is_active: is_active ?? 1,
          auto_apply: auto_apply ?? 0,
          sort: sort || 0,
          status: status ?? 0,
          created_by: req.user?.id ? BigInt(req.user.id) : undefined
        }
      });

      const created = await prisma.dynamic_rate_configs.findUnique({ where: { id: config.id } });
      success(res, { ...created!, id: Number(created!.id) }, 'Success', 200);
    } catch (err: any) {
      console.error('Dynamic rate store error:', err);
      error(res, 'Failed to create dynamic rate config', 500);
    }
  }

  /**
   * GET /api/dynamic-rates/:id
   * Show single config
   */
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });

      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      success(res, { ...config, id: Number(config.id), property_id: Number(config.property_id) }, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate show error:', err);
      error(res, 'Failed to fetch dynamic rate config', 500);
    }
  }

  /**
   * GET /api/dynamic-rates/:id/edit
   * Get config with master data for edit form
   */
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });

      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      const master = {
        statuses: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' }
        ],
        forecast_methods: [
          { value: 'moving_average', label: 'Moving Average' },
          { value: 'exponential_smoothing', label: 'Exponential Smoothing' },
          { value: 'linear_regression', label: 'Linear Regression' },
          { value: 'seasonal_naive', label: 'Seasonal Naive' },
          { value: 'manual', label: 'Manual' }
        ]
      };

      success(res, { ...config, id: Number(config.id), property_id: Number(config.property_id), master }, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  /**
   * PUT /api/dynamic-rates/:id
   * Update config
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const {
        name, forecast_method, gdp_growth_rate, inflation_rate,
        adjustment_sensitivity, min_adjustment_percent, max_adjustment_percent,
        lookback_days, forecast_days, target_occupancy, seasonality_factors,
        is_active, auto_apply, sort, status
      } = req.body;

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The name field is required.'];
      if (!forecast_method) errors.forecast_method = ['The forecast method field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const data: any = {
        name,
        forecast_method,
        gdp_growth_rate,
        inflation_rate,
        adjustment_sensitivity,
        min_adjustment_percent,
        max_adjustment_percent,
        lookback_days,
        forecast_days,
        target_occupancy,
        seasonality_factors: seasonality_factors || undefined,
        is_active,
        auto_apply,
        sort,
        status,
        updated_by: req.user?.id ? BigInt(req.user.id) : undefined
      };

      await prisma.dynamic_rate_configs.update({ where: { id }, data });

      const updated = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      success(res, { ...updated!, id: Number(updated!.id) }, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate update error:', err);
      error(res, 'Failed to update dynamic rate config', 500);
    }
  }

  /**
   * DELETE /api/dynamic-rates/:id
   * Soft delete config
   */
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      await prisma.dynamic_rate_configs.update({
        where: { id },
        data: {
          deleted_at: new Date(),
          status: 0,
          deleted_by: req.user?.id ? BigInt(req.user.id) : undefined
        }
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate destroy error:', err);
      error(res, 'Failed to delete dynamic rate config', 500);
    }
  }

  /**
   * DELETE /api/dynamic-rates/:id/force
   * Force delete config
   */
  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      await prisma.dynamic_rate_results.deleteMany({ where: { dynamic_rate_config_id: id } });
      await prisma.dynamic_rate_configs.delete({ where: { id } });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate force delete error:', err);
      error(res, 'Failed to force delete dynamic rate config', 500);
    }
  }

  static async disable(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const existing = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) { notFound(res, 'Dynamic rate config not found'); return; }
      await prisma.dynamic_rate_configs.update({ where: { id }, data: { is_active: 0, updated_at: new Date() } });
      success(res, null, 'Config disabled');
    } catch (err: any) { console.error('Dynamic rate disable error:', err); error(res, 'Failed to disable config', 500); }
  }

  /**
   * POST /api/dynamic-rates/:id/calculate
   * Run calculation engine
   */
  static async calculate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const { room_type_ids } = req.body;

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      const propertyId = config.property_id;
      const forecastDays = config.forecast_days || 30;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get room types
      const roomTypeWhere: any = { property_id: propertyId, deleted_at: null };
      if (room_type_ids?.length) {
        roomTypeWhere.id = { in: room_type_ids.map((rtId: any) => BigInt(rtId)) };
      }
      const roomTypes = await prisma.room_types.findMany({
        where: roomTypeWhere,
        select: { id: true, name: true }
      });

      if (!roomTypes.length) {
        success(res, { results_count: 0 }, 'No room types found');
        return;
      }

      let resultsCount = 0;

      for (const roomType of roomTypes) {
        for (let day = 0; day < forecastDays; day++) {
          const date = new Date(today);
          date.setDate(date.getDate() + day);

          // Get existing rate_rates for base rate
          const rateRate = await prisma.rate_rates.findFirst({
            where: {
              room_type_id: roomType.id,
              date: {
                gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
                lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
              },
              deleted_at: null
            },
            orderBy: { id: 'desc' }
          });

          const baseRateOne = rateRate?.one_adult ? Number(rateRate.one_adult) : 0;
          const baseRateTwo = rateRate?.two_adult ? Number(rateRate.two_adult) : 0;
          const baseRate = baseRateOne || baseRateTwo || 0;

          // Calculate adjustment based on forecast method
          const adjustmentPercent = DynamicRateController.calcAdjustment(
            config.forecast_method || 'moving_average',
            config.gdp_growth_rate ? Number(config.gdp_growth_rate) : 0,
            config.inflation_rate ? Number(config.inflation_rate) : 0,
            config.adjustment_sensitivity ? Number(config.adjustment_sensitivity) : 1,
            day
          );

          const minAdj = config.min_adjustment_percent ? Number(config.min_adjustment_percent) : -100;
          const maxAdj = config.max_adjustment_percent ? Number(config.max_adjustment_percent) : 100;
          const clampedAdj = Math.max(minAdj, Math.min(maxAdj, adjustmentPercent));

          const suggestedOne = baseRate > 0 ? baseRate * (1 + clampedAdj / 100) : 0;
          const suggestedTwo = baseRate > 0 ? baseRate * (1 + clampedAdj / 100) : 0;

          const gdpImpact = config.gdp_growth_rate ? Number(config.gdp_growth_rate) * 0.1 : 0;
          const inflationImpact = config.inflation_rate ? Number(config.inflation_rate) * 0.05 : 0;

          const seasonalityFactor = DynamicRateController.getSeasonalityFactor(
            config.seasonality_factors,
            date.getMonth()
          );

          // Upsert to handle unique constraint
          await prisma.dynamic_rate_results.upsert({
            where: {
              property_id_dynamic_rate_config_id_room_type_id_date: {
                property_id: propertyId,
                dynamic_rate_config_id: id,
                room_type_id: roomType.id,
                date
              }
            },
            update: {
              historical_adr: baseRate,
              forecasted_occupancy: config.target_occupancy || 70,
              base_rate: baseRate,
              suggested_rate_one_adult: Math.round(suggestedOne * 100) / 100,
              suggested_rate_two_adult: Math.round(suggestedTwo * 100) / 100,
              adjustment_percent: clampedAdj,
              gdp_impact: gdpImpact,
              inflation_impact: inflationImpact,
              seasonality_factor: seasonalityFactor,
              occupancy_factor: 1,
              confidence_score: DynamicRateController.calcConfidence(day, forecastDays),
              forecast_method_used: config.forecast_method || 'moving_average',
              updated_by: req.user?.id ? BigInt(req.user.id) : undefined
            },
            create: {
              property_id: propertyId,
              dynamic_rate_config_id: id,
              room_type_id: roomType.id,
              date,
              historical_adr: baseRate,
              forecasted_occupancy: config.target_occupancy || 70,
              base_rate: baseRate,
              suggested_rate_one_adult: Math.round(suggestedOne * 100) / 100,
              suggested_rate_two_adult: Math.round(suggestedTwo * 100) / 100,
              adjustment_percent: clampedAdj,
              gdp_impact: gdpImpact,
              inflation_impact: inflationImpact,
              seasonality_factor: seasonalityFactor,
              occupancy_factor: 1,
              confidence_score: DynamicRateController.calcConfidence(day, forecastDays),
              forecast_method_used: config.forecast_method || 'moving_average',
              sort: day,
              status: 1,
              created_by: req.user?.id ? BigInt(req.user.id) : undefined
            }
          });

          resultsCount++;
        }
      }

      success(res, { results_count: resultsCount }, 'Calculation completed');
    } catch (err: any) {
      console.error('Dynamic rate calculate error:', err);
      error(res, 'Failed to calculate dynamic rates', 500);
    }
  }

  /**
   * POST /api/dynamic-rates/:id/apply
   * Apply suggested rates to rate_rates table
   */
  static async apply(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const { start_date, end_date, room_type_id } = req.body;

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      const where: any = {
        dynamic_rate_config_id: id,
        is_applied: 0,
        deleted_at: null
      };

      if (start_date) {
        where.date = { ...(where.date || {}), gte: new Date(start_date) };
      }
      if (end_date) {
        where.date = { ...(where.date || {}), lte: new Date(end_date) };
      }
      if (room_type_id) {
        where.room_type_id = BigInt(room_type_id);
      }

      const results = await prisma.dynamic_rate_results.findMany({ where });

      if (!results.length) {
        success(res, { applied_count: 0 }, 'No results to apply');
        return;
      }

      let appliedCount = 0;

      for (const result of results) {
        const suggestedOne = result.suggested_rate_one_adult ? Number(result.suggested_rate_one_adult) : 0;
        const suggestedTwo = result.suggested_rate_two_adult ? Number(result.suggested_rate_two_adult) : 0;

        // Find existing rate_rates for same room_type + date
        const existingRate = await prisma.rate_rates.findFirst({
          where: {
            room_type_id: result.room_type_id,
            date: result.date,
            deleted_at: null
          },
          orderBy: { id: 'desc' }
        });

        if (existingRate) {
          await prisma.rate_rates.update({
            where: { id: existingRate.id },
            data: {
              one_adult: suggestedOne,
              two_adult: suggestedTwo,
              updated_by: req.user?.id ? BigInt(req.user.id) : undefined
            }
          });
        } else {
          // Need a rate_id to create — use first available rate for this property
          const firstRate = await prisma.rates.findFirst({
            where: { property_id: config.property_id, deleted_at: null },
            orderBy: { id: 'asc' }
          });

          if (firstRate) {
            await prisma.rate_rates.create({
              data: {
                property_id: config.property_id,
                rate_id: firstRate.id,
                room_type_id: result.room_type_id,
                date: result.date,
                one_adult: suggestedOne,
                two_adult: suggestedTwo,
                extra_adult: 0,
                extra_child: 0,
                min_night: 0,
                max_night: 0,
                stop_arrival: 0,
                stop_departure: 0,
                stop_sell: 0,
                min_los: 0,
                sort: 0,
                status: 1,
                created_by: req.user?.id ? BigInt(req.user.id) : undefined
              }
            });
          }
        }

        // Mark result as applied
        await prisma.dynamic_rate_results.update({
          where: { id: result.id },
          data: {
            is_applied: 1,
            applied_at: new Date(),
            updated_by: req.user?.id ? BigInt(req.user.id) : undefined
          }
        });

        appliedCount++;
      }

      success(res, { applied_count: appliedCount }, 'Rates applied successfully');
    } catch (err: any) {
      console.error('Dynamic rate apply error:', err);
      error(res, 'Failed to apply dynamic rates', 500);
    }
  }

  /**
   * POST /api/dynamic-rates/:id/sync
   * Calculate + Apply in one call
   */
  static async sync(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      // Temporary override to do calculate
      const calcReq = {
        ...req,
        body: { room_type_ids: req.body.room_type_ids }
      } as unknown as Request;

      // Run calculate inline
      const propertyId = config.property_id;
      const forecastDays = config.forecast_days || 30;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const roomTypeWhere: any = { property_id: propertyId, deleted_at: null };
      if (req.body.room_type_ids?.length) {
        roomTypeWhere.id = { in: req.body.room_type_ids.map((rtId: any) => BigInt(rtId)) };
      }
      const roomTypes = await prisma.room_types.findMany({
        where: roomTypeWhere,
        select: { id: true, name: true }
      });

      if (!roomTypes.length) {
        success(res, { results_count: 0, applied_count: 0 }, 'No room types found');
        return;
      }

      let resultsCount = 0;

      for (const roomType of roomTypes) {
        for (let day = 0; day < forecastDays; day++) {
          const date = new Date(today);
          date.setDate(date.getDate() + day);

          const rateRate = await prisma.rate_rates.findFirst({
            where: {
              room_type_id: roomType.id,
              date: {
                gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
                lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
              },
              deleted_at: null
            },
            orderBy: { id: 'desc' }
          });

          const baseRateOne = rateRate?.one_adult ? Number(rateRate.one_adult) : 0;
          const baseRateTwo = rateRate?.two_adult ? Number(rateRate.two_adult) : 0;
          const baseRate = baseRateOne || baseRateTwo || 0;

          const adjustmentPercent = DynamicRateController.calcAdjustment(
            config.forecast_method || 'moving_average',
            config.gdp_growth_rate ? Number(config.gdp_growth_rate) : 0,
            config.inflation_rate ? Number(config.inflation_rate) : 0,
            config.adjustment_sensitivity ? Number(config.adjustment_sensitivity) : 1,
            day
          );

          const minAdj = config.min_adjustment_percent ? Number(config.min_adjustment_percent) : -100;
          const maxAdj = config.max_adjustment_percent ? Number(config.max_adjustment_percent) : 100;
          const clampedAdj = Math.max(minAdj, Math.min(maxAdj, adjustmentPercent));

          const suggestedOne = baseRate > 0 ? Math.round(baseRate * (1 + clampedAdj / 100) * 100) / 100 : 0;
          const suggestedTwo = baseRate > 0 ? Math.round(baseRate * (1 + clampedAdj / 100) * 100) / 100 : 0;

          const gdpImpact = config.gdp_growth_rate ? Number(config.gdp_growth_rate) * 0.1 : 0;
          const inflationImpact = config.inflation_rate ? Number(config.inflation_rate) * 0.05 : 0;
          const seasonalityFactor = DynamicRateController.getSeasonalityFactor(config.seasonality_factors, date.getMonth());

          await prisma.dynamic_rate_results.upsert({
            where: {
              property_id_dynamic_rate_config_id_room_type_id_date: {
                property_id: propertyId,
                dynamic_rate_config_id: id,
                room_type_id: roomType.id,
                date
              }
            },
            update: {
              historical_adr: baseRate,
              forecasted_occupancy: config.target_occupancy || 70,
              base_rate: baseRate,
              suggested_rate_one_adult: suggestedOne,
              suggested_rate_two_adult: suggestedTwo,
              adjustment_percent: clampedAdj,
              gdp_impact: gdpImpact,
              inflation_impact: inflationImpact,
              seasonality_factor: seasonalityFactor,
              occupancy_factor: 1,
              confidence_score: DynamicRateController.calcConfidence(day, forecastDays),
              forecast_method_used: config.forecast_method || 'moving_average',
              is_applied: 1,
              applied_at: new Date(),
              updated_by: req.user?.id ? BigInt(req.user.id) : undefined
            },
            create: {
              property_id: propertyId,
              dynamic_rate_config_id: id,
              room_type_id: roomType.id,
              date,
              historical_adr: baseRate,
              forecasted_occupancy: config.target_occupancy || 70,
              base_rate: baseRate,
              suggested_rate_one_adult: suggestedOne,
              suggested_rate_two_adult: suggestedTwo,
              adjustment_percent: clampedAdj,
              gdp_impact: gdpImpact,
              inflation_impact: inflationImpact,
              seasonality_factor: seasonalityFactor,
              occupancy_factor: 1,
              confidence_score: DynamicRateController.calcConfidence(day, forecastDays),
              forecast_method_used: config.forecast_method || 'moving_average',
              is_applied: 1,
              applied_at: new Date(),
              sort: day,
              status: 1,
              created_by: req.user?.id ? BigInt(req.user.id) : undefined
            }
          });

          // Update/create rate_rates
          const existingRate = await prisma.rate_rates.findFirst({
            where: { room_type_id: roomType.id, date, deleted_at: null },
            orderBy: { id: 'desc' }
          });

          if (existingRate) {
            await prisma.rate_rates.update({
              where: { id: existingRate.id },
              data: { one_adult: suggestedOne, two_adult: suggestedTwo }
            });
          } else {
            const firstRate = await prisma.rates.findFirst({
              where: { property_id: propertyId, deleted_at: null },
              orderBy: { id: 'asc' }
            });
            if (firstRate) {
              await prisma.rate_rates.create({
                data: {
                  property_id: propertyId,
                  rate_id: firstRate.id,
                  room_type_id: roomType.id,
                  date,
                  one_adult: suggestedOne,
                  two_adult: suggestedTwo,
                  extra_adult: 0, extra_child: 0, min_night: 0, max_night: 0,
                  stop_arrival: 0, stop_departure: 0, stop_sell: 0, min_los: 0,
                  sort: 0, status: 1,
                  created_by: req.user?.id ? BigInt(req.user.id) : undefined
                }
              });
            }
          }

          resultsCount++;
        }
      }

      success(res, { results_count: resultsCount, applied_count: resultsCount }, 'Sync completed');
    } catch (err: any) {
      console.error('Dynamic rate sync error:', err);
      error(res, 'Failed to sync dynamic rates', 500);
    }
  }

  /**
   * GET /api/dynamic-rates/:id/results
   * Paginated list of calculation results
   */
  static async results(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;
      const roomTypeId = req.query.room_type_id as string;

      const where: any = {
        dynamic_rate_config_id: id,
        deleted_at: null
      };

      if (startDate) where.date = { ...(where.date || {}), gte: new Date(startDate) };
      if (endDate) where.date = { ...(where.date || {}), lte: new Date(endDate) };
      if (roomTypeId) where.room_type_id = BigInt(roomTypeId);

      const [results, total] = await Promise.all([
        prisma.dynamic_rate_results.findMany({
          where,
          orderBy: { date: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            room_types: { select: { id: true, name: true } }
          }
        }),
        prisma.dynamic_rate_results.count({ where })
      ]);

      const formatted = results.map(r => ({
        ...r,
        id: Number(r.id),
        property_id: Number(r.property_id),
        dynamic_rate_config_id: Number(r.dynamic_rate_config_id),
        room_type_id: Number(r.room_type_id),
        room_type: r.room_types ? { id: Number(r.room_types.id), name: r.room_types.name } : null,
        room_types: undefined
      }));

      // Get room types for filter dropdown
      const config = await prisma.dynamic_rate_configs.findUnique({
        where: { id },
        select: { property_id: true }
      });

      let roomTypeOptions: any[] = [];
      if (config) {
        const roomTypes = await prisma.room_types.findMany({
          where: { property_id: config.property_id, deleted_at: null, status: 1 },
          select: { id: true, name: true },
          orderBy: { name: 'asc' }
        });
        roomTypeOptions = roomTypes.map(rt => ({ value: Number(rt.id), label: rt.name }));
      }

      const table = [
        { label: 'Date', key: 'date', type: 'date', is_search: false },
        { label: 'Room Type', key: 'room_type', type: 'none', is_search: false },
        { label: 'Base Rate', key: 'base_rate', type: 'currency', is_search: false },
        { label: 'Suggested 1 Adult', key: 'suggested_rate_one_adult', type: 'currency', is_search: false },
        { label: 'Suggested 2 Adult', key: 'suggested_rate_two_adult', type: 'currency', is_search: false },
        { label: 'Adjustment %', key: 'adjustment_percent', type: 'percent', is_search: false },
        { label: 'Confidence', key: 'confidence_score', type: 'percent', is_search: false },
        { label: 'Applied', key: 'is_applied', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false }
      ];

      success(res, { results: formatted, room_type_options: roomTypeOptions }, 'Success', 200, {
        table,
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total)
        }
      });
    } catch (err: any) {
      console.error('Dynamic rate results error:', err);
      error(res, 'Failed to fetch results', 500);
    }
  }

  /**
   * GET /api/dynamic-rates/:id/statistics
   * Dashboard stats for config
   */
  static async statistics(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      const where = { dynamic_rate_config_id: id, deleted_at: null };

      const [totalResults, appliedResults, aggregation] = await Promise.all([
        prisma.dynamic_rate_results.count({ where }),
        prisma.dynamic_rate_results.count({ where: { ...where, is_applied: 1 } }),
        prisma.dynamic_rate_results.aggregate({
          where,
          _avg: { adjustment_percent: true, confidence_score: true },
          _min: { date: true },
          _max: { date: true }
        })
      ]);

      const stats = {
        total_results: totalResults,
        applied_count: appliedResults,
        pending_count: totalResults - appliedResults,
        avg_adjustment_percent: aggregation._avg.adjustment_percent ? Number(aggregation._avg.adjustment_percent) : 0,
        avg_confidence_score: aggregation._avg.confidence_score ? Number(aggregation._avg.confidence_score) : 0,
        date_from: aggregation._min.date,
        date_to: aggregation._max.date,
        apply_rate: totalResults > 0 ? Math.round((appliedResults / totalResults) * 100 * 100) / 100 : 0
      };

      success(res, stats, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate statistics error:', err);
      error(res, 'Failed to fetch statistics', 500);
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────

  /**
   * Calculate adjustment percent based on forecast method
   */
  private static calcAdjustment(
    method: string,
    gdpGrowthRate: number,
    inflationRate: number,
    sensitivity: number,
    day: number
  ): number {
    switch (method) {
      case 'moving_average':
        // Simple baseline with small random variance
        return (gdpGrowthRate + inflationRate) / 2 * sensitivity + (Math.random() - 0.5) * 2;
      case 'exponential_smoothing':
        // Decay-based: larger adjustments early, smaller later
        return (gdpGrowthRate + inflationRate) / 2 * sensitivity * Math.exp(-day / 30);
      case 'linear_regression':
        // Linear trend based on day
        return (gdpGrowthRate + inflationRate) / 2 * sensitivity + (day * 0.1);
      case 'seasonal_naive':
        // Cyclical pattern
        return (gdpGrowthRate + inflationRate) / 2 * sensitivity + Math.sin(day * Math.PI / 7) * 5;
      case 'manual':
      default:
        return (gdpGrowthRate + inflationRate) / 2 * sensitivity;
    }
  }

  /**
   * Get seasonality factor from stored JSON by month index (0-11)
   */
  private static getSeasonalityFactor(seasonalityJson: any, month: number): number {
    if (!seasonalityJson) return 1;
    try {
      const factors = typeof seasonalityJson === 'string' ? JSON.parse(seasonalityJson) : seasonalityJson;
      if (Array.isArray(factors) && factors.length > month) {
        return Number(factors[month]) || 1;
      }
      if (factors && typeof factors === 'object' && factors[month] !== undefined) {
        return Number(factors[month]) || 1;
      }
      return 1;
    } catch {
      return 1;
    }
  }

  /**
   * Calculate confidence score — higher for nearer dates
   */
  private static calcConfidence(day: number, totalDays: number): number {
    const score = 100 - (day / totalDays) * 40;
    return Math.round(Math.max(20, Math.min(100, score)) * 100) / 100;
  }
}
