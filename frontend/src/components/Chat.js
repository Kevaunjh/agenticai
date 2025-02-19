import React, { useState, useEffect, useRef } from "react";
import { getOpenAIResponse } from "./OpenAICall";

const Chat = () => {
    const [inputText, setInputText] = useState("");
    const [responses, setResponses] = useState([]);
    const [loading, setLoading] = useState(false);

    const handleInputChange = (e) => setInputText(e.target.value);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!inputText.trim()) return;

        setLoading(true);

        // Initialize new response object
        const newResponse = { user: inputText, ai: "" };
        setResponses((prev) => [...prev, newResponse]);

        try {
            await getOpenAIResponse(inputText, (chunk) => {
                setResponses((prev) => {
                    const updatedResponses = [...prev];

                    // Ensure only the latest response is updated
                    updatedResponses[updatedResponses.length - 1] = {
                        ...updatedResponses[updatedResponses.length - 1],
                        ai: updatedResponses[updatedResponses.length - 1].ai + chunk,
                    };

                    return updatedResponses;
                });
            });

            setInputText("");
        } catch (error) {
            console.error("Error fetching OpenAI response:", error);
            setResponses((prev) => [
                ...prev.slice(0, -1),
                { user: inputText, ai: "Failed to fetch response. Please try again." },
            ]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    return (
        <div className="flex flex-col w-1/2 p-6 space-y-4">
            <h1 className="text-2xl font-semibold text-center">Google Calendar AI Assistant</h1>
            <div className="flex-grow bg-gray-800 p-5 rounded-lg shadow-lg border border-gray-700 overflow-y-auto custom-scrollbar">
                <div className="space-y-4">
                    {responses.length > 0 ? (
                        responses.map((response, index) => (
                            <div key={index} className="flex flex-col space-y-2">
                                <div className="self-end max-w-xs bg-blue-500 text-white p-3 rounded-lg shadow-md">
                                    <p>{response.user}</p>
                                </div>
                                <div className="self-start max-w-xs bg-gray-700 p-3 rounded-lg shadow-md">
                                    <p className="text-sm font-semibold text-green-400">Calendar Assistant</p>
                                    <p>{response.ai}</p>
                                </div>
                            </div>
                        ))
                    ) : (
                        <p className="text-gray-400">Start a conversation to manage your schedule!</p>
                    )}
                </div>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
                <textarea
                    className="w-full p-3 rounded-lg bg-gray-700 text-white text-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Type your message here..."
                    value={inputText}
                    onChange={handleInputChange}
                    onKeyPress={handleKeyPress}
                ></textarea>
                <button
                    type="submit"
                    className="w-full py-3 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold text-md transition-all disabled:opacity-50"
                    disabled={loading}
                >
                    {loading ? "Sending..." : "Send"}
                </button>
            </form>
        </div>
    );
};

export default Chat;