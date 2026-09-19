import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  Collection,
  Agent,
  QuerySession,
  ListQuerySessionsResponse,
  GetQuerySessionResponse,
  Query,
  QueryRequest,
  AuthState,
} from "./types";

interface PagedListResponse<T> {
  count: number;
  limit: number;
  name: string;
  start: number;
  items: T[];
}

const PAGE_SIZE = 100;

export const chatApi = createApi({
  reducerPath: "chatApi",
  tagTypes: ["QuerySession"],
  baseQuery: fetchBaseQuery({
    baseUrl: "/api/ram-proxy",
    prepareHeaders: (headers, { getState }) => {
      const state = getState() as { auth?: AuthState };
      const token = state?.auth?.access_token;
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return headers;
    },
  }),
  endpoints: (builder) => ({
    // 1. Fetch document collections
    getCollections: builder.query<Collection[], void>({
      query: () => ({
        url: "",
        method: "GET",
        params: {
          endpoint: `/collections?limit=${PAGE_SIZE}&start=0`,
        },
      }),
      transformResponse: (response: PagedListResponse<Collection>) =>
        response.items.sort((a, b) => a.name.localeCompare(b.name)),
    }),

    // 2. Fetch available retrieval agents
    getAgents: builder.query<Agent[], void>({
      query: () => ({
        url: "",
        method: "GET",
        params: {
          endpoint: `/agents?limit=${PAGE_SIZE}&start=0`,
        },
      }),
      transformResponse: (response: PagedListResponse<Agent>) =>
        response.items.sort((a, b) => a.name.localeCompare(b.name)),
    }),

    // 3. Fetch past chat sessions
    getSessions: builder.query<QuerySession[], void>({
      query: () => ({
        url: "",
        method: "GET",
        params: {
          endpoint: "/querySessions?sortBy=insertTimestamp:descending",
        },
      }),
      transformResponse: (response: ListQuerySessionsResponse) => response.items,
      providesTags: ["QuerySession"],
    }),

    // 4. Fetch queries (message history) for a specific session
    getQuerySession: builder.query<GetQuerySessionResponse, string>({
      query: (sessionId: string) => ({
        url: "",
        method: "GET",
        params: {
          endpoint: `/query?filter=eq(querySessionId,${sessionId})`,
        },
      }),
    }),

    // 5. Send a prompt/question to an agent
    sendQuery: builder.mutation<Query, QueryRequest>({
      query: (request: QueryRequest) => ({
        url: "",
        method: "POST",
        params: {
          endpoint: "/query",
          synchronous: "true",
          persist: "true",
        },
        body: request,
      }),
      invalidatesTags: ["QuerySession"],
    }),
  }),
});

export const {
  useGetCollectionsQuery,
  useGetAgentsQuery,
  useGetSessionsQuery,
  useGetQuerySessionQuery,
  useSendQueryMutation,
} = chatApi;
