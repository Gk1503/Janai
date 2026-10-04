import mongoose from 'mongoose';
import dns from 'node:dns';

// Some local DNS resolvers refuse SRV lookups needed by mongodb+srv:// URIs
dns.setServers(['8.8.8.8', '1.1.1.1']);

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in backend/.env');

  await mongoose.connect(uri);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);
}
