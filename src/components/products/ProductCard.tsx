import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, ShoppingCart, Eye, Star } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../hooks/useCart';
import { useWishlist } from '../../hooks/useWishlist';
import type { Product } from '../../types';

interface ProductCardProps {
  product: Product;
  index?: number;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, index = 0 }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addToCart, isLoading: cartLoading } = useCart();
  const { addToWishlist, removeFromWishlist, isInWishlist, isLoading: wishlistLoading } = useWishlist();
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const getProductName = (product: Product) => {
    return product.product_name || product.name || 'Unnamed Product';
  };

  const getProductPrice = (product: Product) => {
    return product.price ? Number(product.price) : 0;
  };

  const getMainImage = (product: Product) => {
    if (product.product_images && product.product_images.length > 0) {
      return product.product_images[0].image_url;
    }
    return 'https://images.pexels.com/photos/1191531/pexels-photo-1191531.jpeg';
  };

  const handleAddToCart = async () => {
    try {
      await addToCart(product.id, 1);
      toast.success('Added to cart!');
    } catch (error) {
      toast.error('Failed to add to cart');
    }
  };

  const handleWishlistToggle = async () => {
    try {
      if (isInWishlist(product.id)) {
        await removeFromWishlist(product.id);
        toast.success('Removed from wishlist');
      } else {
        await addToWishlist(product.id);
        toast.success('Added to wishlist');
      }
    } catch (error) {
      toast.error('Failed to update wishlist');
    }
  };

  const handleBuyNow = async () => {
    if (!user) {
      toast.error('Please sign in to make a purchase');
      return;
    }

    if (!product.availability) {
      toast.error('Product is currently out of stock');
      return;
    }

    try {
      setIsProcessingPayment(true);

      // Load Razorpay script
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      document.body.appendChild(script);

      script.onload = async () => {
        try {
          // Use the Supabase Edge Function to create a payment session
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
          if (!supabaseUrl) {
            throw new Error('Supabase URL not configured');
          }

          const response = await fetch(`${supabaseUrl}/functions/v1/create_payment_session`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${user.access_token || ''}`
            },
            body: JSON.stringify({ productId: product.id })
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to create payment session');
          }

          const sessionData = await response.json();
          const { orderId, razorpayOrderId, amount, currency } = sessionData;

          // Configure Razorpay options
          const options = {
            key: import.meta.env.VITE_RAZORPAY_KEY_ID,
            amount: amount * 100, // Razorpay expects amount in paise
            currency: currency || 'INR',
            name: 'AXELS Jewelry',
            description: `Purchase: ${getProductName(product)}`,
            image: '/favicon.svg',
            order_id: razorpayOrderId,
            handler: async (response: any) => {
              try {
                // Verify payment
                const verifyResponse = await fetch(`${supabaseUrl}/functions/v1/verify_payment`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${user.access_token || ''}`
                  },
                  body: JSON.stringify({
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                    order_id: orderId
                  })
                });

                if (!verifyResponse.ok) {
                  const errorData = await verifyResponse.json();
                  throw new Error(errorData.error || 'Payment verification failed');
                }

                const verifyData = await verifyResponse.json();

                if (verifyData.success) {
                  toast.success('Payment successful! Your order has been confirmed.');
                  navigate(`/account?tab=orders&highlight=${orderId}`);
                } else {
                  throw new Error('Payment verification failed');
                }
              } catch (error) {
                console.error('Payment verification error:', error);
                toast.error('Payment verification failed. Please contact support.');
              } finally {
                setIsProcessingPayment(false);
              }
            },
            prefill: {
              name: user.user_metadata?.full_name || '',
              email: user.email || '',
              contact: user.user_metadata?.phone || ''
            },
            notes: {
              product_id: product.id,
              product_name: getProductName(product)
            },
            theme: {
              color: '#C6A050'
            },
            modal: {
              ondismiss: () => {
                setIsProcessingPayment(false);
                toast.error('Payment cancelled');
              }
            }
          };

          // Open Razorpay checkout
          const razorpay = new (window as any).Razorpay(options);
          razorpay.open();

        } catch (error) {
          console.error('Payment initiation error:', error);
          toast.error(error instanceof Error ? error.message : 'Failed to initiate payment');
          setIsProcessingPayment(false);
        }
      };

      script.onerror = () => {
        toast.error('Failed to load payment gateway');
        setIsProcessingPayment(false);
      };

    } catch (error) {
      console.error('Buy now error:', error);
      toast.error('Failed to process purchase');
      setIsProcessingPayment(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="group relative bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300"
    >
      {/* Product Image */}
      <div className="relative aspect-square overflow-hidden">
        <img
          src={getMainImage(product)}
          alt={getProductName(product)}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        
        {/* Overlay Actions */}
        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-300 flex items-center justify-center">
          <div className="flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <Link
              to={`/products/${product.id}`}
              className="bg-white p-2 rounded-full hover:bg-gray-100 transition-colors"
            >
              <Eye className="w-5 h-5 text-gray-700" />
            </Link>
            <button
              onClick={handleWishlistToggle}
              disabled={wishlistLoading}
              className="bg-white p-2 rounded-full hover:bg-gray-100 transition-colors"
            >
              <Heart 
                className={`w-5 h-5 ${
                  isInWishlist(product.id) 
                    ? 'text-red-500 fill-current' 
                    : 'text-gray-700'
                }`} 
              />
            </button>
            <button
              onClick={handleAddToCart}
              disabled={cartLoading}
              className="bg-white p-2 rounded-full hover:bg-gray-100 transition-colors"
            >
              <ShoppingCart className="w-5 h-5 text-gray-700" />
            </button>
          </div>
        </div>

        {/* Availability Badge */}
        {!product.availability && (
          <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded text-xs font-medium">
            Out of Stock
          </div>
        )}

        {/* Featured Badge */}
        {product.featured && (
          <div className="absolute top-2 right-2 bg-gold text-white px-2 py-1 rounded text-xs font-medium">
            Featured
          </div>
        )}
      </div>

      {/* Product Info */}
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 mb-1 line-clamp-2">
          {getProductName(product)}
        </h3>
        
        {/* Category */}
        {product.categories && (
          <p className="text-sm text-gray-500 mb-2">
            {product.categories.name}
          </p>
        )}

        {/* Metal Type */}
        {product.metal_type && (
          <p className="text-sm text-gray-600 mb-2">
            {product.metal_type}
          </p>
        )}

        {/* Price */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-lg font-bold text-gold">
            ₹{getProductPrice(product).toLocaleString()}
          </span>
          
          {/* Rating (placeholder) */}
          <div className="flex items-center">
            <Star className="w-4 h-4 text-yellow-400 fill-current" />
            <span className="text-sm text-gray-600 ml-1">4.5</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-2">
          <button
            onClick={handleAddToCart}
            disabled={cartLoading || !product.availability}
            className="flex-1 bg-gray-100 text-gray-900 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {cartLoading ? 'Adding...' : 'Add to Cart'}
          </button>
          <button
            onClick={handleBuyNow}
            disabled={isProcessingPayment || !product.availability}
            className="flex-1 bg-gold text-white py-2 px-4 rounded-md hover:bg-gold-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {isProcessingPayment ? 'Processing...' : 'Buy Now'}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default ProductCard;