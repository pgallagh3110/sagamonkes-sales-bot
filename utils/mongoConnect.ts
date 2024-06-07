import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('Please add your Mongo URI to .env.local');
}

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient>;

const connectWithRetry = async (retries: number = 5, delay: number = 2000): Promise<MongoClient> => {
  try {
    client = new MongoClient(uri);
    await client.connect();
    console.log('Connected to MongoDB');
    return client;
  } catch (error) {
    if (retries === 0) {
      console.error('Error connecting to MongoDB:', error);
      throw new Error('Failed to connect to MongoDB');
    }
    console.log(`Retrying MongoDB connection (${retries} retries left)...`);
    await new Promise(res => setTimeout(res, delay));
    return connectWithRetry(retries - 1, delay);
  }
};

clientPromise = connectWithRetry();

const getClient = async (): Promise<MongoClient> => {
  if (!client) {
    client = await connectWithRetry();
  }
  return client;
};

export { clientPromise, getClient };
