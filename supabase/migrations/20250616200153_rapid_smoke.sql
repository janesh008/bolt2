/*
  # Create Payment Transactions Table
  
  1. New Tables
    - `payment_transactions` - Store payment transaction details
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders)
      - `razorpay_payment_id` (varchar)
      - `razorpay_order_id` (varchar)
      - `amount` (numeric)
      - `currency` (varchar)
      - `status` (varchar)
      - `payment_method` (varchar)
      - `gateway_response` (jsonb)
      - `created_at` (timestamp)
  
  2. Security
    - Foreign key constraint to orders table
    - Index on order_id for better performance
*/

-- Create payment_transactions table
CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  razorpay_payment_id varchar(100),
  razorpay_order_id varchar(100),
  amount numeric(10,2) NOT NULL,
  currency varchar(3) DEFAULT 'INR',
  status varchar(50),
  payment_method varchar(50),
  gateway_response jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_id ON payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_payment_id ON payment_transactions(razorpay_payment_id);