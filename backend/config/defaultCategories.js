import Category from '../models/Category.js';

// These five names are the categories products have always used (previously a
// hardcoded enum on Product). They need to exist as real Category documents
// so the Categories page and the Add Product dropdown — which now both read
// from the Category collection — keep showing them for existing products.
const ORIGINAL_CATEGORIES = ['Fruits', 'Vegetables', 'Groceries', 'Combo Packs', 'Seasonal Specials'];
const collation = { locale: 'en', strength: 2 };

export async function ensureDefaultCategories() {
  for (const [index, name] of ORIGINAL_CATEGORIES.entries()) {
    const exists = await Category.findOne({ name }).collation(collation);
    if (!exists) await Category.create({ name, status: 'Active', displayOrder: index });
  }
}
