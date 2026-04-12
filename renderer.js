const input = document.getElementById("input");
const response = document.getElementById("response");
const time = document.getElementById("time");

// live time
setInterval(() => {
  time.innerText = new Date().toLocaleTimeString();
}, 1000);

// simple bot
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const text = input.value.toLowerCase();

    if (text.includes("hello")) {
      response.innerText = "Hi Hassan 👋";
    } else if (text.includes("time")) {
      response.innerText = new Date().toLocaleTimeString();
    } else {
      response.innerText = "I don't understand 😅";
    }

    input.value = "";
  }
});
