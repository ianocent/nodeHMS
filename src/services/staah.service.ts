import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

interface StaahConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  authMode: 'token' | 'basic';
  timeout: number;
}

export class StaahService {
  private config: StaahConfig;
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.config = {
      baseUrl: process.env.STAAH_BASE_URL || 'https://api.staah.net',
      clientId: process.env.STAAH_CLIENT_ID || '',
      clientSecret: process.env.STAAH_CLIENT_SECRET || '',
      authMode: (process.env.STAAH_AUTH_MODE as 'token' | 'basic') || 'token',
      timeout: parseInt(process.env.STAAH_TIMEOUT || '30'),
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout * 1000,
    });

    this.client.interceptors.request.use(async (config) => {
      const headers = await this.getAuthHeaders();
      Object.assign(config.headers, headers);
      return config;
    });
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return { Authorization: `Bearer ${this.accessToken}` };
    }

    if (this.config.authMode === 'basic') {
      return this.getBasicAuthHeaders();
    }

    try {
      const response = await axios.get(
        `${this.config.baseUrl}/SUAPI/jservice/auth/generate-access-token`,
        {
          headers: {
            'client-id': this.config.clientId,
            'client-secret': this.config.clientSecret,
          },
          timeout: this.config.timeout * 1000,
        }
      );

      const token =
        response.data?.Data?.token ||
        response.data?.Data?.access_token ||
        response.data?.data?.token ||
        response.data?.data?.access_token ||
        response.data?.token ||
        response.data?.access_token;

      if (token) {
        this.accessToken = token;
        this.tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 minutes
        return { Authorization: `Bearer ${token}` };
      }
    } catch {
      console.warn('Staah token auth failed, falling back to Basic auth');
    }

    return this.getBasicAuthHeaders();
  }

  private getBasicAuthHeaders(): Record<string, string> {
    const basic = Buffer.from(`${this.config.clientSecret}:`).toString('base64');
    return {
      Authorization: `Basic ${basic}`,
      'app-id': this.config.clientId,
    };
  }

  async testConnection(): Promise<any> {
    const response = await this.client.get('/SUAPI/jservice/pmsproperty');
    return { success: response.status === 200, status: response.status, data: response.data };
  }

  async listingProperty(): Promise<any> {
    const response = await this.client.get('/SUAPI/jservice/pmsproperty');
    return response.data;
  }

  async createUpdateProperty(data: any): Promise<any> {
    const response = await this.client.post('/SUAPI/jservice/OTA_HotelDescriptiveContentNotif', data);
    return response.data;
  }

  async deleteProperty(data: any): Promise<any> {
    const response = await this.client.post('/SUAPI/jservice/RemoveProperty', data);
    return response.data;
  }

  async createUpdateDeleteRoomType(data: any): Promise<any> {
    const response = await this.client.post('/SUAPI/jservice/OTA_HotelRoom', data);
    return response.data;
  }

  async createUpdateDeleteRatePlan(data: any): Promise<any> {
    const response = await this.client.post('/SUAPI/jservice/OTA_HotelRatePlan', data);
    return response.data;
  }

  async listingRoomType(hotelId: string): Promise<any> {
    const response = await this.client.post('/SUAPI/jservice/roomdetails', { hotelid: hotelId });
    return response.data;
  }

  async listingRatePlan(hotelId: string): Promise<any> {
    const response = await this.client.post('/SUAPI/jservice/ratedetails', { hotelid: hotelId });
    return response.data;
  }

  async listingReservations(hotelId: string): Promise<any> {
    const response = await this.client.post('/SUAPI/jservice/Reservation', { hotelid: hotelId });
    return response.data;
  }

  async acknowledgeReservationNotifications(hotelId: string, notificationIds: string[]): Promise<any> {
    const response = await this.client.post('/SUAPI/jservice/Reservation_notif', {
      hotelid: hotelId,
      reservation_notif: { reservation_notif_id: notificationIds },
    });
    return response.data;
  }

  async confirmRequestBooking(bookingId: string): Promise<any> {
    const response = await this.client.post('/SUAPI/service/requestbookings', { bookingid: bookingId });
    return response.data;
  }

  async cancelRequestBooking(bookingId: string): Promise<any> {
    const response = await this.client.post('/SUAPI/service/requestbookings', {
      bookingid: bookingId,
      status: 'cancel',
    });
    return response.data;
  }

  async storeRates(data: any): Promise<any> {
    const response = await this.client.post('/SUAPI/jservice/availability', data);
    return response.data;
  }

  async listBookings(hotelId: string, dateFrom: string, dateTo: string): Promise<any> {
    const response = await this.client.post('/SUAPI/jservice/Bookings', {
      Su_hotelid: hotelId,
      date_from: dateFrom,
      date_to: dateTo,
    });
    return response.data;
  }

  async refetchBooking(hotelId: string, bookingId: string): Promise<any> {
    const response = await this.client.post('/SUAPI/jservice/getReservation', {
      hotelid: hotelId,
      bookingid: bookingId,
    });
    return response.data;
  }
}
