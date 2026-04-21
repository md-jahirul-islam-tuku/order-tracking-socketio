import { getCollection } from "../config/database.js";
import {
  calculateTotals,
  createOrderDocument,
  generateOrderId,
} from "../utils/helper.js";

export const orderHandler = (io, socket) => {
  console.log("user connected", socket.id);

  // place order
  socket.on("placeOrder", async (data, callback) => {
    try {
      console.log(`Placed order from ${socket.id}`);
      const validation = validateOrder(data);
      if (!validation.valid) {
        return callback({ success: false, message: validation.message });
      }
      const totals = calculateTotals(data.items);
      const orderId = generateOrderId();
      const order = createOrderDocument(data, orderId, totals);
      const ordersCollection = getCollection("orders");
      await ordersCollection.insertOne(order);
      socket.join(`order-${orderId}`);
      socket.join("customers");
      io.to("admins").emit("newOrder", { order });
      callback({ success: true, order });
      console.log(`order created: ${orderId}`);
    } catch (error) {
      console.log(error);
      callback({ success: false, message: "Failed to place order..." });
    }
  });
  socket.on("trackOrder", async (data, callback) => {
    try {
      const ordersCollection = getCollection("orders");
      const order = await ordersCollection.findOne({ orderId: data.orderId });
      if (!order) {
        return callback({ success: false, message: "Order not found" });
      }
      socket.join(`order-${data.orderId}`);
      callback({ success: true, order });
    } catch (error) {
      console.error("Order tracking error", error);
      callback({ success: false, message: error.message });
    }
  });
};
