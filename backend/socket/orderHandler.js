import { getCollection } from "../config/database.js";
import {
  calculateTotals,
  createOrderDocument,
  generateOrderId,
  isValidStatusTransition,
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
  socket.on("cancelOrder", async (data, callback) => {
    try {
      const ordersCollection = getCollection("orders");
      const order = await ordersCollection.findOne({ orderId: data.orderId });
      if (!order) {
        return callback({ success: false, message: "Order not found" });
      }
      if (!["pending", "confirmed"].includes(order.status)) {
        return callback({
          success: false,
          message: "Can not cancel the order",
        });
      }
      await ordersCollection.updateOne(
        { orderId: data.orderId },
        {
          $set: { status: "cancelled", updatedAt: new Date() },
          $push: {
            statusHistory: {
              status: "cancelled",
              timestamp: new Date(),
              by: socket.id,
              note: data.reason || "Cancelled by customer",
            },
          },
        },
      );
      io.to(`order-${data.orderId}`).emit("orderCancelled", {
        orderId: data.orderId,
      });
      io.to(
        "admins".emit("orderCancelled", {
          orderId: data.orderId,
          customerName: order.customerName,
        }),
        callback({ success: true }),
      );
    } catch (error) {
      console.error("Cancel order error", error);
      callback({ success: false, message: error.message });
    }
  });
  socket.on("getMyOrders", async (data, callback) => {
    try {
      const ordersCollection = getCollection("orders");
      const orders = await ordersCollection
        .findOne({
          customerPhone: data.customerPhone,
        })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();
      callback({ success: true, orders });
    } catch (error) {
      console.error("Get orders error", error);
      callback({ success: false, message: error.message });
    }
  });
  // admin event

  // admin login
  socket.on("adminLogin", async (data, callback) => {
    try {
      if (data.password == process.env.ADMIN_PASSWORD) {
        socket.isAdmin = true;
        socket.join("admins");
        console.log(`admin logged in: ${socket.id}`);
        callback({ success: true });
      } else {
        callback({ success: false, message: "invalid password" });
      }
    } catch (error) {
      callback({ success: false, message: "Login failed" });
    }
  });
  // admin get all orders
  socket.on("getAllOrders", async (data, callback) => {
    try {
      if (!socket.isAdmin) {
        return callback({ success: false, message: "Unauthorized" });
      }
      const ordersCollection = getCollection("orders");
      const filter = data?.status ? { status: data.status } : {};
      const orders = await ordersCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();
      callback({ success: true, orders });
    } catch (error) {
      callback({ success: false, message: error.message });
    }
  });
  socket.on("updateOrderStatus", async (data, callback) => {
    try {
      const ordersCollection = getCollection("orders");
      const order = await ordersCollection.findOne({
        orderId: data.orderId,
      });
      if (!order) {
        return callback({ success: false, message: "Order not found" });
      }
      if (!isValidStatusTransition(order.status, data.newStatus)) {
        return callback({
          success: false,
          message: "Invalid status transition",
        });
      }
      const result = await ordersCollection.findOneAndUpdate(
        {
          orderId: data.orderId,
        },
        {
          $set: { status: data.newStatus, updatedAt: new Date() },
          $push: {
            statusHistory: {
              status: data.newStatus,
              timestamp: new Date(),
              by: socket.id,
              note: "Status update by Admin",
            },
          },
        },
      );
      io.to(`order-${data.orderId}`).emit("statusUpdated", {
        orderId: data.orderId,
        status: data.newStatus,
        order: result,
      });
      socket.to("admins").emit("orderStatusChanged", {
        orderId: data.orderId,
        newStatus: data.newStatus,
      });
      callback({ success: true, order: result });
    } catch (error) {}
  });
  socket.on("acceptOrder", async (data, callback) => {
    try {
      if (!socket.isAdmin) {
        return callback({ success: false, message: "Unauthorized" });
      }
      const ordersCollection = getCollection("orders");
      const order = await ordersCollection.findOne({
        orderId: data.orderId,
      });
      if (!order || order.status !== "pending") {
        return callback({
          success: false,
          message: "Can not accept this order",
        });
      }
      const estimatedTime = data.estimatedTime || 30;
      const result = await ordersCollection.findOneAndUpdate(
        {
          orderId: data.orderId,
        },
        {
          $set: { status: "Confirmed", estimatedTime, updatedAt: new Date() },
          $push: {
            statusHistory: {
              status: "Confirmed",
              timestamp: new Date(),
              by: socket.id,
              note: `Accepted with ${estimatedTime} mins estimated time`,
            },
          },
        },
        {
          returnDocument: "after",
        },
      );
      io.to(`order-${data.orderId}`).emit("statusUpdated", {
        orderId: data.orderId,
        estimatedTime,
      });
      socket.to("admins").emit("orderAcceptedByAdmin", {
        orderId: data.orderId,
      });
      callback({ success: true, order: result });
    } catch (error) {
      callback({ success: false, message: error.message });
    }
  });
  socket.on("rejectOrder", async (data, callback) => {
    try {
      if (!socket.isAdmin) {
        return callback({ success: false, message: "Unauthorized" });
      }
      const ordersCollection = getCollection("orders");
      const order = await ordersCollection.findOne({
        orderId: data.orderId,
      });
      if (!order || order.status !== "pending") {
        return callback({
          success: false,
          message: "Can not reject this order",
        });
      }
      await ordersCollection.updateOne(
        {
          orderId: data.orderId,
        },
        {
          $set: { status: "cancelled", updatedAt: new Date() },
          $push: {
            statusHistory: {
              status: "cancelled",
              timestamp: new Date(),
              by: socket.id,
              note: `Rejected ${data.reason}`,
            },
          },
        },
      );
      io.to(`order-${data.orderId}`).emit("orderRejected", {
        orderId: data.orderId,
        reason: data.reason,
      });
      callback({ success: true });
    } catch (error) {
      console.log("Reject order error", error);
      callback({ success: false, message: "Failed to reject order" });
    }
  });
  socket.on("getLiveStats", async (callback) => {
    try {
      if (!socket.isAdmin) {
        return callback({ success: false, message: "Unauthorized" });
      }
      const ordersCollection = getCollection("orders");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const stats = {
        totalToday: await ordersCollection.countDocument({
          createdAt: { $gte: today },
        }),
        pending: await ordersCollection.countDocument({ status: "pending" }),
        confirmed: await ordersCollection.countDocument({
          status: "confirmed",
        }),
        preparing: await ordersCollection.countDocument({
          status: "preparing",
        }),
        ready: await ordersCollection.countDocument({ status: "ready" }),
        outForDelivery: await ordersCollection.countDocument({
          status: "out_for_delivery",
        }),
        delivered: await ordersCollection.countDocument({
          status: "delivered",
        }),
        cancelled: await ordersCollection.countDocument({
          status: "cancelled",
        }),
      };
      callback({ success: true, stats });
    } catch (error) {
      console.log("Get stats error", error);
      callback({ success: false, message: "Failed to load stats" });
    }
  });
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    if (!socket.isAdmin) {
      socket.to("admins").emit("adminDisconnected", { adminId: socket.id });
    }
  });
};
