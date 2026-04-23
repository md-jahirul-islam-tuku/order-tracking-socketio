import "./App.css";
import { useSocket } from "./hooks/useSocket";

function App() {
  const { socket, connected } = useSocket();

  return (
    <div>
      {`This is socket ${connected}`}
      <h1>{socket?.id}</h1>
    </div>
  );
}

export default App;
