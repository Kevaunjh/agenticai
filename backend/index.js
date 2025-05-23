const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const date = require('date-and-time');
require('dotenv').config();

// Structured format to be used in OpenAI action calls 
const createEventFormat = `
  "summary": "Google I/O 2015",
  "location": "800 Howard St., San Francisco, CA 94103",
  "description": "A chance to hear more about Google\'s developer products.",
  "colorId": A number from 1-11, 
  "start": {
    "dateTime": "2015-05-28T09:00:00-07:00",
    "timeZone": "America/Los_Angeles",
  },
  "end": {
    "dateTime": "2015-05-28T17:00:00-07:00",
    "timeZone": "America/Los_Angeles",
  },
  "recurrence": [
    "RRULE:FREQ=DAILY;COUNT=2"
  ],
  "attendees": [
    {"email": "lpage@example.com"},
    {"email": "sbrin@example.com"},
  ],
  "reminders": {
    "useDefault": false,
    "overrides": [
      {"method": "email", "minutes": 24 * 60},
      {"method": "popup", "minutes": 10},
    ],
  },`

const conversationHistory = [];

// Initialize OpenAI Client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initalize Google Authentication Client
const oAuth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage',
);

const app = express();
const port = process.env.PORT || 8070;
app.use(cors());
app.use(express.json());

// Function to determine which operation the user would like to perform (create, update, delete, etc.)
const selectAction = async (prompt, upcomingEvents) => {
  const classifyAction = await openaiClient.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `
        Classify the user's intent into one of the following categories: 
        - "CREATE_EVENT": If the user wants to create or schedule an event. Or, if they describe an upcoming event that doesn't already exist.
        - "DELETE_EVENT": If the user wants to delete any event(s).
        - "UPDATE_EVENT": If the user provides additional information for an existing event.
        - "OTHER": For all other requests.
        ONLY return the classifier, nothing else, regardless of the user input. 
        Here is the user's schedule information as context to help you in the classification: ${upcomingEvents}. 
        You will now be provided with the user's latest few messages. Act on the newest one, using prior ones as context.
        `,
      },
      ...conversationHistory,
      { role: "user", content: prompt },
    ]
  })

  const action = classifyAction.choices[0].message.content;
  console.log("Action Classification:", action);
  return action;
}

// Function to get the user's upcoming events
async function getUpcomingEvents(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 20,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items;

    if (!events.length) {
      console.log('No upcoming events found.');
      return [];
    }

    // Store only event ID, summary, start/endtime
    const eventSummaries = events.map(event => ({
      id: event.id,
      summary: event.summary,
      startTime: event.start,
      endTime: event.start,
    }));

    return eventSummaries;
  } catch (error) {
    console.error('Error fetching events:', error);
    return [];
  }
}

// Function to create an event for the user's Google Calendar
async function createEvent(accessToken, prompt, currentDate) {
  // Generate the structured event data from user input, via an OpenAI call. 
  const createEventCompletion = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
        You are an assistant that creates events using Google Calendar. 
            - The current date/time is ${currentDate}. 
            - When asked to create an event, you will ONLY respond in a structured format, exactly like the following example: ${createEventFormat}.
            - The only mandatory fields are the start and end time (in ISO 8601 format), use 30 minutes as the default length.
            - Fill the other fields as you deem suitable. Don't set notifications, email addresses or recurring events unless explicitly told to do so.
            - Don't set a location unless you can determine an appropriate one from the user's input (no made-up locations).
            Assume the timezone is GMT-4 (Eastern Daylight Saving Time). Ensure the dates exist in the calendar (e.g no February 29th in non-leap years).` },
      { role: "user", content: prompt },
    ],
  });

  eventData = JSON.parse(createEventCompletion.choices[0].message.content);
  console.log(eventData);

  // Insert the data 
  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({ version: "v3", auth });
    const response = await calendar.events.insert({
      auth: auth,
      calendarId: "primary",
      resource: eventData,
    });

    console.log("Event created successfully");
    return { success: true, link: response.data.htmlLink };
  } catch (error) {
    console.error("Error creating event:", error);
    throw new Error("Failed to create Google Calendar event");
  }
}

// Function to delete an event from the user's Google Calendar
async function deleteEvents(accessToken, prompt, currentDate, upcomingEvents) {

  const deleteEventCompletion = await openaiClient.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: `You are an assistant that deletes events using Google Calendar. 
            The current date/time is ${currentDate}. 
            When asked to delete any number of events, you will identify the correct events to delete 
            and respond with ONLY the event ids in a comma seperated list, regardless of user input. 
            Following are the user's upcoming events with their IDs: ${upcomingEvents}`
      },
      { role: "user", content: prompt },
    ],
  });

  eventIds = deleteEventCompletion.choices[0].message.content;
  var eventIdArray = eventIds.split(',').map(id => id.trim());

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const calendar = google.calendar({ version: 'v3', auth });

  for (i = 0; i < eventIdArray.length; i++) {
    try {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: eventIdArray[i],
      });

      console.log(`Event with ID ${eventIdArray[i]} deleted successfully.`);
    } catch (error) {
      console.error('Error deleting event:', error);
      return false;
    }
  }
  return true;
}

// Function to update an event on the user's Google Calendar
async function updateEvent(accessToken, prompt, currentDate, upcomingEvents) {

  const updateEventCompletion = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are an assistant that updates events using Google Calendar.
            The current date/time is ${currentDate}. 
            When asked to update an event, you will:
            1. Identify the correct event to update based on user input and the upcoming events list.
            2. Respond ONLY with a JSON object in this format:
                  {
                    "eventId": "EVENT_ID_HERE",
                    "updatedEvent": {
                      ${createEventFormat}
                    }
                  }
            Fill the details as you deem appropriate based on the user input. If a field is unchanged, provide the original value.
            Don't change the location, time, recurrence, or color unless explicitly told to do so.
            Ensure the dates exist in the calendar (e.g no February 29th in non-leap years).
            Following are the user's upcoming events with their IDs: ${upcomingEvents}`
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" }
  });

  console.log(updateEventCompletion.choices[0].message.content);
  const { eventId, updatedEvent } = JSON.parse(updateEventCompletion.choices[0].message.content);

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    const response = await calendar.events.patch({
      calendarId: 'primary',
      eventId: eventId,
      resource: updatedEvent,
    });

    console.log(`Event with ID ${eventId} updated successfully.`);
    return response.data;
  } catch (error) {
    console.error('Error updating event:', error);
    return null;
  }
}


// Google Authentication Route
app.post("/api/google-auth", async (req, res) => {
  const { tokens } = await oAuth2Client.getToken(req.body.tokenResponse); // Exchange code for tokens  
  oAuth2Client.setCredentials(tokens);
  res.json(tokens);
});

// OpenAI Chat Route
app.post("/api/openai", async (req, res) => {
  // User prompt
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res
      .status(400)
      .json({ success: false, error: "Invalid or missing 'prompt' field" });
  }

  conversationHistory.push({ role: "user", content: prompt }); // Add the user input to the conversation history

  // Limit length of the conversation history
  if (conversationHistory.length > 8) {
    conversationHistory.shift(); // remove the oldest message
  }

  // Get the current date/time.
  var currentDate = new Date();
  currentDate = date.format(currentDate, 'hh:mm A ddd, MMM DD YYYY');

  // Access token from frontend for interaction w/ Google Calendar
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }
  const access_token = authHeader.split(" ")[1];

  // Store upcoming events to provide in OpenAI call.
  var upcomingEvents = await getUpcomingEvents(access_token);
  upcomingEvents = JSON.stringify(upcomingEvents);

  // Determine which action the user wishes to perform
  const calendarAction = await selectAction(prompt, upcomingEvents);

  if (calendarAction == "CREATE_EVENT") {
    await createEvent(access_token, prompt, currentDate);
  }
  else if (calendarAction == "DELETE_EVENT") {
    await deleteEvents(access_token, prompt, currentDate, upcomingEvents)
  }
  else if (calendarAction == "UPDATE_EVENT") {
    await updateEvent(access_token, prompt, currentDate, upcomingEvents)
  }

  try {
    // OpenAI call to provide the user a response in the chat. 
    const userResponseCompletion = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
          You are an AI assistant that helps schedule events using Google Calendar. 
        - ONLY respond to relevant prompts. State that you can't speak on unrelated topics.
        - The current date/time is ${currentDate}.
        - Please provide a concise and friendly response confirming that the intended action has been performed. 
        - The action that will be taken by the backend for this request is: ${calendarAction}. Ensure your response to the user matches this action. 
        - Information on the user's upcoming schedule: ${upcomingEvents}. 
          - Only refer to this information if the user specifically asks something about their schedule.(ex. upcoming events, how to optimize, etc.)  
        - Never provide the user with their upcoming schedule data directly in the chat. 
        - Don't use any text formatting or code blocks. 
        You will now be provided with the user's latest few messages. Respond to the newest one.`},
        ...conversationHistory,
        { role: "user", content: prompt },
      ],
      stream: true,
    })

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    for await (const chunk of userResponseCompletion) {
      if (chunk.choices[0]?.delta?.content) {
        const text = chunk.choices[0].delta.content;

        res.write(text);  // Send response to frontend
      }
    }

    res.write("\n\n");
    res.end();
  }
  catch (error) {
    console.error("OpenAI Streaming Error:", error);
    res.status(500).json({ error: "Error fetching OpenAI response" });
  }
});

// Start Server
app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
