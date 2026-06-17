import DeliveryCompany from '../models/DeliveryCompany.js';

export async function createTestDeliveryCompany() {
  try {
    // Remove mock delivery company if it exists (do not recreate)
    const existing = await DeliveryCompany.findOne({ name: 'Test Courier' });
    if (existing) {
      await DeliveryCompany.deleteOne({ _id: existing._id });
    }
    return null;
  } catch (err) {
    console.error('Failed to create test delivery company:', err.message);
    throw err;
  }
}
