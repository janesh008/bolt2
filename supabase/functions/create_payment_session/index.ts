import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID") || "rzp_test_95lpU4BLVjzNkI"; // Fallback to test key
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || ""; // No fallback for secret

    // Validate environment variables
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables");
    }

    // Get user from auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Parse request body
    const requestData = await req.json();
    
    // Handle both single product and cart checkout
    let items = [];
    let shippingAddress = null;
    
    if (requestData.productId) {
      // Single product checkout
      items = [{ product_id: requestData.productId, quantity: 1 }];
    } else if (requestData.items && Array.isArray(requestData.items)) {
      // Cart checkout
      items = requestData.items;
      shippingAddress = requestData.shippingAddress;
    } else {
      return new Response(JSON.stringify({
        error: "Invalid request data"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (items.length === 0) {
      return new Response(JSON.stringify({
        error: "No items provided"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Create admin client
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get or create customer
    let customerId;
    const { data: customer, error: customerError } = await adminClient
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (customerError) {
      // Create customer if not exists
      const { data: newCustomer, error: createError } = await adminClient
        .from("customers")
        .insert({
          user_id: user.id,
          email: user.email,
          first_name: user.user_metadata?.full_name?.split(" ")[0] || "",
          last_name: user.user_metadata?.full_name?.split(" ").slice(1).join(" ") || "",
          phone: user.user_metadata?.phone || "",
          role: "user"
        })
        .select("id")
        .single();

      if (createError) {
        return new Response(JSON.stringify({
          error: "Failed to create customer"
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      customerId = newCustomer.id;
    } else {
      customerId = customer.id;
    }

    // Calculate total amount
    let totalAmount = 0;
    
    // Fetch product details and calculate total
    for (const item of items) {
      const { data: product, error: productError } = await adminClient
        .from("products")
        .select("price")
        .eq("id", item.product_id)
        .single();

      if (productError || !product) {
        return new Response(JSON.stringify({
          error: `Product not found: ${item.product_id}`
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      totalAmount += product.price * item.quantity;
    }

    // Add tax (5%)
    const taxAmount = totalAmount * 0.05;
    const finalAmount = totalAmount + taxAmount;

    // Generate receipt ID
    const receiptId = `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Create Razorpay order
    // For development, we'll simulate the Razorpay response
    let razorpayOrderId;
    
    if (razorpayKeyId && razorpayKeySecret) {
      try {
        const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Basic ${btoa(`${razorpayKeyId}:${razorpayKeySecret}`)}`
          },
          body: JSON.stringify({
            amount: Math.round(finalAmount * 100), // Convert to paise
            currency: "INR",
            receipt: receiptId,
            notes: {
              customer_id: customerId,
              user_id: user.id
            }
          })
        });

        if (!razorpayResponse.ok) {
          const razorpayError = await razorpayResponse.json();
          console.error("Razorpay error:", razorpayError);
          
          // For development, continue with a mock order ID
          razorpayOrderId = `order_${Date.now()}`;
        } else {
          const razorpayOrder = await razorpayResponse.json();
          razorpayOrderId = razorpayOrder.id;
        }
      } catch (error) {
        console.error("Razorpay API error:", error);
        // For development, continue with a mock order ID
        razorpayOrderId = `order_${Date.now()}`;
      }
    } else {
      // For development without Razorpay keys
      razorpayOrderId = `order_${Date.now()}`;
    }

    // Create order in database
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .insert({
        customer_id: customerId,
        order_number: `ORD-${Date.now().toString().substring(7)}`,
        status: "pending",
        total_amount: finalAmount,
        payment_status: "pending",
        payment_method: "Razorpay",
        razorpay_order_id: razorpayOrderId,
        shipping_address: shippingAddress ? JSON.stringify(shippingAddress) : null
      })
      .select("id")
      .single();

    if (orderError) {
      console.error("Order creation error:", orderError);
      return new Response(JSON.stringify({
        error: "Failed to create order"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Create order items
    for (const item of items) {
      const { data: product, error: productError } = await adminClient
        .from("products")
        .select("price")
        .eq("id", item.product_id)
        .single();

      if (productError || !product) {
        console.error("Product fetch error:", productError);
        continue; // Skip this item but continue with the order
      }

      const { error: orderItemError } = await adminClient
        .from("order_items")
        .insert({
          order_id: order.id,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: product.price,
          total_price: product.price * item.quantity
        });

      if (orderItemError) {
        console.error("Order item creation error:", orderItemError);
        // Continue anyway as the main order is created
      }
    }

    // Create shipping address record if provided
    if (shippingAddress) {
      const { error: shippingError } = await adminClient
        .from("shipping_addresses")
        .insert({
          order_id: order.id,
          name: shippingAddress.name,
          phone: shippingAddress.phone,
          address_line1: shippingAddress.address_line1,
          address_line2: shippingAddress.address_line2 || null,
          city: shippingAddress.city,
          state: shippingAddress.state,
          country: shippingAddress.country,
          pincode: shippingAddress.pincode
        });

      if (shippingError) {
        console.error("Shipping address creation error:", shippingError);
        // Continue anyway as the main order is created
      }
    }

    // Add initial order timeline entry
    const { error: timelineError } = await adminClient
      .from("order_timeline")
      .insert({
        order_id: order.id,
        status: "pending",
        notes: "Order created and awaiting payment"
      });

    if (timelineError) {
      console.error("Order timeline creation error:", timelineError);
      // Continue anyway as the main order is created
    }

    return new Response(JSON.stringify({
      orderId: order.id,
      razorpayOrderId: razorpayOrderId,
      amount: finalAmount,
      currency: "INR"
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      error: error.message || "Internal server error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});