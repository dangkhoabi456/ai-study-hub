const crypto = require("crypto");
const path = require("path");
const supabase = require("../config/supabase");

const BUCKET = process.env.SUPABASE_DOCUMENT_BUCKET || "documents";
const LIBRARY_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;

function sanitizeFileName(fileName) {
  return path
    .basename(fileName || "imported-file.bin")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160);
}

async function getImportableLibrary(libraryId, userId) {
  const { data: library, error } = await supabase
    .from("libraries")
    .select("id, user_id, name, description, is_public, share_on_profile, created_at")
    .eq("id", libraryId)
    .maybeSingle();

  if (error) throw error;

  const canAccess =
    library &&
    (library.is_public || String(library.user_id) === String(userId));

  return canAccess ? library : null;
}

async function getImportableDocuments(libraryId) {
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, file_url, file_size_bytes, created_at")
    .eq("library_id", libraryId)
    .eq("status", "APPROVED")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

exports.previewLibraryImport = async (req, res) => {
  try {
    const { libraryId } = req.params;
    const library = await getImportableLibrary(libraryId, req.user.id);

    if (!library) {
      return res.status(404).json({
        status: "error",
        message: "Library not found or is not available for import.",
      });
    }

    const documents = await getImportableDocuments(libraryId);

    return res.status(200).json({
      status: "success",
      data: {
        id: library.id,
        name: library.name,
        description: library.description || "",
        visibility: library.is_public ? "public" : "private",
        documents: documents.length,
        folders: 0,
        totalBytes: documents.reduce(
          (total, document) =>
            total + (Number(document.file_size_bytes) || 0),
          0,
        ),
      },
    });
  } catch (error) {
    console.error("Preview library import error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not inspect this library for import.",
      error: error.message,
    });
  }
};

exports.importLibrary = async (req, res) => {
  const copiedStoragePaths = [];
  const insertedDocumentIds = [];
  let importedLibraryId = null;

  try {
    const { libraryId } = req.params;
    const userId = req.user.id;
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();

    if (!name) {
      return res.status(400).json({
        status: "error",
        message: "Library name is required.",
      });
    }

    if (name.length > 50 || description.length > 350) {
      return res.status(400).json({
        status: "error",
        message: "Library name or description exceeds the allowed length.",
      });
    }

    const sourceLibrary = await getImportableLibrary(libraryId, userId);
    if (!sourceLibrary) {
      return res.status(404).json({
        status: "error",
        message: "Library not found or is not available for import.",
      });
    }

    const { data: duplicateLibrary, error: duplicateError } = await supabase
      .from("libraries")
      .select("id")
      .eq("user_id", userId)
      .ilike("name", name)
      .maybeSingle();

    if (duplicateError) throw duplicateError;
    if (duplicateLibrary) {
      return res.status(409).json({
        status: "error",
        code: "DUPLICATE_LIBRARY_NAME",
        message: `You already have a library named "${name}".`,
      });
    }

    const sourceDocuments = await getImportableDocuments(libraryId);
    const incomingBytes = sourceDocuments.reduce(
      (total, document) => total + (Number(document.file_size_bytes) || 0),
      0,
    );
    const { data: existingDocuments, error: storageError } = await supabase
      .from("documents")
      .select("file_size_bytes")
      .eq("uploader_id", userId)
      .not("library_id", "is", null)
      .is("deleted_at", null);

    if (storageError) throw storageError;

    const currentBytes = (existingDocuments || []).reduce(
      (total, document) => total + (Number(document.file_size_bytes) || 0),
      0,
    );
    if (currentBytes + incomingBytes > LIBRARY_STORAGE_LIMIT_BYTES) {
      return res.status(400).json({
        status: "error",
        code: "USER_LIBRARY_STORAGE_LIMIT_EXCEEDED",
        message:
          "Importing this library would exceed your shared 50MB library storage limit.",
      });
    }

    const { data: importedLibrary, error: libraryInsertError } = await supabase
      .from("libraries")
      .insert({
        user_id: userId,
        name,
        description: description || sourceLibrary.description || "",
        is_public: false,
        share_on_profile: false,
      })
      .select()
      .single();

    if (libraryInsertError) throw libraryInsertError;
    importedLibraryId = importedLibrary.id;

    const sourceDocumentIds = sourceDocuments.map((document) => document.id);
    let sourceChunks = [];
    let sourceTags = [];

    if (sourceDocumentIds.length > 0) {
      const [
        { data: chunks, error: chunksError },
        { data: tags, error: tagsError },
      ] = await Promise.all([
        supabase
          .from("document_chunks")
          .select("document_id, chunk_index, content, embedding")
          .in("document_id", sourceDocumentIds),
        supabase
          .from("document_tags")
          .select("document_id, tag_id")
          .in("document_id", sourceDocumentIds),
      ]);

      if (chunksError) throw chunksError;
      if (tagsError) throw tagsError;
      sourceChunks = chunks || [];
      sourceTags = tags || [];
    }

    for (const sourceDocument of sourceDocuments) {
      const targetStoragePath =
        `${userId}/${Date.now()}-${crypto.randomUUID()}-` +
        sanitizeFileName(sourceDocument.title);
      const { error: copyError } = await supabase.storage
        .from(BUCKET)
        .copy(sourceDocument.file_url, targetStoragePath);

      if (copyError) throw copyError;
      copiedStoragePaths.push(targetStoragePath);

      const { data: importedDocument, error: documentInsertError } =
        await supabase
          .from("documents")
          .insert({
            uploader_id: userId,
            workspace_id: null,
            library_id: importedLibrary.id,
            title: sourceDocument.title,
            file_url: targetStoragePath,
            file_size_bytes: sourceDocument.file_size_bytes,
            is_public: false,
            status: "APPROVED",
            ai_reject_reason: null,
          })
          .select("id")
          .single();

      if (documentInsertError) throw documentInsertError;
      insertedDocumentIds.push(importedDocument.id);

      const chunksToInsert = sourceChunks
        .filter(
          (chunk) =>
            String(chunk.document_id) === String(sourceDocument.id),
        )
        .map((chunk) => ({
          document_id: importedDocument.id,
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          embedding: chunk.embedding,
        }));
      const tagsToInsert = sourceTags
        .filter(
          (tag) => String(tag.document_id) === String(sourceDocument.id),
        )
        .map((tag) => ({
          document_id: importedDocument.id,
          tag_id: tag.tag_id,
          assigned_by: userId,
        }));

      if (chunksToInsert.length > 0) {
        const { error } = await supabase
          .from("document_chunks")
          .insert(chunksToInsert);
        if (error) throw error;
      }

      if (tagsToInsert.length > 0) {
        const { error } = await supabase
          .from("document_tags")
          .insert(tagsToInsert);
        if (error) throw error;
      }
    }

    const { error: downloadLogError } = await supabase
      .from("library_downloads")
      .insert({ library_id: sourceLibrary.id });
    if (downloadLogError) {
      console.warn(
        "Could not record imported library download:",
        downloadLogError,
      );
    }

    return res.status(201).json({
      status: "success",
      data: {
        ...importedLibrary,
        documents: sourceDocuments.length,
        visibility: "private",
        sourceLibraryId: sourceLibrary.id,
      },
    });
  } catch (error) {
    console.error("Import library error:", error);

    if (insertedDocumentIds.length > 0) {
      await supabase
        .from("document_tags")
        .delete()
        .in("document_id", insertedDocumentIds);
      await supabase
        .from("document_chunks")
        .delete()
        .in("document_id", insertedDocumentIds);
      await supabase
        .from("documents")
        .delete()
        .in("id", insertedDocumentIds);
    }
    if (importedLibraryId) {
      await supabase
        .from("libraries")
        .delete()
        .eq("id", importedLibraryId);
    }
    if (copiedStoragePaths.length > 0) {
      await supabase.storage.from(BUCKET).remove(copiedStoragePaths);
    }

    return res.status(500).json({
      status: "error",
      message: "Could not import this library.",
      error: error.message,
    });
  }
};
