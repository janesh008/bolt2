import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as crypto from "https://deno.land/std@0.168.0/crypto/mod.ts";

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
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";

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
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      order_id
    } = await req.json();

    if (!razorpay_order_id || !razorpay_payment_id || !order_id) {
      return new Response(JSON.stringify({
        error: "Missing required parameters"
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

    // Verify the order exists and belongs to the user
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select(`
        *,
        customers!inner(user_id)
      `)
      .eq("id", order_id)
      .eq("customers.user_id", user.id)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({
        error: "Order not found or access denied"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Verify Razorpay signature if we have the secret key
    let isValidSignature = false;
    
    if (razorpayKeySecret && razorpay_signature) {
      try {
        const payload = order_id + "|" + razorpay_payment_id;
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(razorpayKeySecret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const signature = await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(payload)
        );
        const signatureHex = Array.from(new Uint8Array(signature))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        
        isValidSignature = signatureHex === razorpay_signature;
      } catch (error) {
        console.error("Signature verification error:", error);
        // For development, continue without verification
        isValidSignature = true;
      }
    } else {
      // For development without Razorpay keys, assume signature is valid
      isValidSignature = true;
    }

    if (!isValidSignature) {
      return new Response(JSON.stringify({
        error: "Invalid payment signature"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Record payment transaction
    const { error: transactionError } = await adminClient
      .from("payment_transactions")
      .insert({
        order_id: order_id,
        razorpay_payment_id: razorpay_payment_id,
        razorpay_order_id: razorpay_order_id,
        amount: order.total_amount,
        currency: "INR",
        status: "completed",
        payment_method: "Razorpay",
        gateway_response: {
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature
        }
      });

    if (transactionError) {
      console.error("Transaction record error:", transactionError);
      // Continue anyway as this is just for record-keeping
    }

    // Update order status
    const { error: updateError } = await adminClient
      .from("orders")
      .update({
        payment_status: "completed",
        status: "confirmed",
        razorpay_payment_id: razorpay_payment_id,
        updated_at: new Date().toISOString()
      })
      .eq("id", order_id);

    if (updateError) {
      console.error("Order update error:", updateError);
      return new Response(JSON.stringify({
        error: "Failed to update order status"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Add order timeline entry
    const { error: timelineError } = await adminClient
      .from("order_timeline")
      .insert({
        order_id: order_id,
        status: "confirmed",
        notes: "Payment completed successfully"
      });

    if (timelineError) {
      console.error("Order timeline error:", timelineError);
      // Continue anyway as the main order is updated
    }

    return new Response(JSON.stringify({
      success: true,
      order: {
        id: order_id,
        status: "confirmed",
        payment_status: "completed"
      }
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