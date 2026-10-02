import app from "./app.js";

const PORT = 3000;

console.log("About to listen on", PORT);
app.listen(PORT, () => {
  console.log(`Server is running at port ${PORT}`);
});
console.log("listen() called");
