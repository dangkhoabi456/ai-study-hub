import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LuBookPlus, LuLibraryBig } from "react-icons/lu";
import "./CreateLibraryPage.css";
import api from "../../../utils/api.js";
import { getMyLibraries } from "../../../utils/documentApi.js";
import { getMyProfile } from "../../../utils/profileApi.js";
import ActionPopup from "../../common/ActionPopup/ActionPopup.jsx";

function normalizeLibraryName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function hasDuplicateLibraryName(libraries, name) {
  const normalizedName = normalizeLibraryName(name);

  return libraries.some(
    (library) =>
      normalizeLibraryName(library.name || library.libraryName) ===
      normalizedName,
  );
}

function getInitials(name) {
  const normalizedName = name.trim();

  if (!normalizedName) return "U";

  const nameParts = normalizedName.split(/\s+/);

  if (nameParts.length === 1) {
    return nameParts[0].slice(0, 2).toUpperCase();
  }

  return nameParts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function CreateLibraryPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const TITLE_LIMIT = 20;
  const DESCRIPTION_LIMIT = 350;
  const MAX_LIBRARIES_PER_USER = 5;
  const returnPath = location.state?.from || "/dashboard/home";

  const [libraryName, setLibraryName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [userLibraries, setUserLibraries] = useState([]);
  const [ownerName, setOwnerName] = useState("User");
  const [ownerAvatar, setOwnerAvatar] = useState("");
  const [limitPopup, setLimitPopup] = useState(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const ownerInitials = getInitials(ownerName);

  useEffect(() => {
    let isMounted = true;
    async function loadPageData() {
      try {
        const [librariesData, profile] = await Promise.all([
          getMyLibraries(),
          getMyProfile(),
        ]);

        if (isMounted) {
          const safeLibraries = Array.isArray(librariesData)
            ? librariesData
            : [];
          setUserLibraries(safeLibraries);
          setOwnerName(profile?.full_name || profile?.username || profile?.email || "User");
          setOwnerAvatar(profile?.avatar_url || "");
        }
      } catch (err) {
        console.error("Failed to load create library data:", err);
      }
    }
    loadPageData();
    return () => {
      isMounted = false;
    };
  }, []);

  const trimmedLibraryName = libraryName.trim();
  const trimmedDescription = description.trim();
  const isDuplicateName =
    trimmedLibraryName.length > 0 &&
    hasDuplicateLibraryName(userLibraries, trimmedLibraryName);
  const hasReachedLibraryLimit = userLibraries.length >= MAX_LIBRARIES_PER_USER;

  const previewName = trimmedLibraryName || "Untitled library";
  const previewDescription =
    trimmedDescription ||
    "This library helps students manage learning resources, upload documents, and use AI to summarize or ask questions from files.";

  const titleCountClass = libraryName.length >= TITLE_LIMIT ? "is-warning" : "";
  const descriptionProgress = useMemo(() => {
    return Math.min((description.length / DESCRIPTION_LIMIT) * 100, 100);
  }, [description.length]);

  function handleReturn() {
    navigate(returnPath);
  }

  async function handleCreateLibrary(e) {
    e.preventDefault();

    if (hasReachedLibraryLimit) {
      setLimitPopup({
        type: "alert",
        title: "Library limit reached",
        message: `You can create up to ${MAX_LIBRARIES_PER_USER} libraries. Delete an existing library before creating another one.`,
        confirmText: "Got it",
      });
      return;
    }

    setHasAttemptedSubmit(true);

    if (trimmedLibraryName === "") {
      return;
    }

    if (trimmedLibraryName.length > TITLE_LIMIT) {
      alert(`Library name cannot exceed ${TITLE_LIMIT} characters.`);
      return;
    }

    if (isDuplicateName) {
      alert("A library with this name already exists. Please choose another name.");
      return;
    }

    if (trimmedDescription.length > DESCRIPTION_LIMIT) {
      alert(`Library description cannot exceed ${DESCRIPTION_LIMIT} characters.`);
      return;
    }

    try {
      const latestLibraries = await getMyLibraries();
      const safeLatestLibraries = Array.isArray(latestLibraries)
        ? latestLibraries
        : [];

      setUserLibraries(safeLatestLibraries);

      if (safeLatestLibraries.length >= MAX_LIBRARIES_PER_USER) {
        setLimitPopup({
          type: "alert",
          title: "Library limit reached",
          message: `You can create up to ${MAX_LIBRARIES_PER_USER} libraries. Delete an existing library before creating another one.`,
          confirmText: "Got it",
        });
        return;
      }

      if (hasDuplicateLibraryName(safeLatestLibraries, trimmedLibraryName)) {
        alert("A library with this name already exists. Please choose another name.");
        return;
      }

      const isPublic = visibility === "public";

      // 1. GỌI API ĐẨY DỮ LIỆU LÊN SUPABASE
      const response = await api.post("/documents/libraries", {
        name: trimmedLibraryName,
        description: previewDescription,
        is_public: isPublic,
      });

      // Lấy data chuẩn do Supabase tạo ra
      const createdLib = response.data.data;

      navigate(`/dashboard/libraries/${createdLib.id}`, {
        state: {
          from: "/dashboard/create-library",
          library: {
            id: createdLib.id,
            user_id: createdLib.user_id,
            name: createdLib.name,
            description: createdLib.description || "",
            visibility: createdLib.is_public ? "public" : "private",
            is_public: createdLib.is_public,
            documents: 0,
            stars: 0,
            downloads: 0,
            isStarred: false,
          },
        },
      });
    } catch (error) {
      console.error("Lỗi tạo thư viện:", error);
      if (error?.response?.status === 409) {
        alert("A library with this name already exists. Please choose another name.");
        return;
      }

      alert("Lỗi kết nối với máy chủ. Thư viện chưa được lưu vào Database.");
    }
  }

  return (
    <main className="create_library_page">
      <section className="create_library_shell">
        <div className="create_library_hero">
          <div className="create_library_hero_content">
            <button type="button" className="create_library_back" onClick={handleReturn}>
              <i className="ti-angle-left" />
              Back
            </button>

            <span className="create_library_kicker">Library builder</span>
            <h1>Create a focused space for your study files.</h1>
            <p>
              Set up a library for course documents, summaries, research notes,
              and AI-supported learning materials.
            </p>
            <p>{userLibraries.length} / {MAX_LIBRARIES_PER_USER} libraries created</p>

            <div className="create_library_steps" aria-label="Library setup steps">
              <article>
                <strong>01</strong>
                <span>Name your library</span>
              </article>
              <article>
                <strong>02</strong>
                <span>Publishing preference</span>
              </article>
              <article>
                <strong>03</strong>
                <span>Start uploading files</span>
              </article>
            </div>
          </div>

          <aside className="create_library_preview" aria-label="Library preview">
            <div className="preview_topline">
              <div className="preview_icon">
                <LuLibraryBig aria-hidden="true" />
              </div>
              <span className={`preview_badge ${visibility === "private" ? "private" : ""}`}>
                {visibility}
              </span>
            </div>

            <div className="preview_body">
              <span>Live preview</span>
              <h2>{previewName}</h2>
              <p>{previewDescription}</p>
            </div>

            <div className="preview_footer">
              <div>
                <strong>0</strong>
                <span>Documents</span>
              </div>
              <div>
                <strong>50MB</strong>
                <span>Storage limit</span>
              </div>
            </div>
          </aside>
        </div>

        <form className="create_library_form" onSubmit={handleCreateLibrary}>
          <section className="form_section form_section_primary">
            <div className="form_section_header">
              <div>
                <span className="section_number">01</span>
                <h2>General information</h2>
                <p>Keep the title short so it displays cleanly across cards and search.</p>
              </div>
            </div>

            <div className="library_name_row">
              <div className="form_group owner_group">
                <label>Owner *</label>
                <button type="button" className="owner_btn">
                  <span className="owner_avatar">
                    {ownerAvatar ? <img src={ownerAvatar} alt="" /> : ownerInitials}
                  </span>
                  <span>{ownerName}</span>
                  <i className="ti-angle-down" />
                </button>
                <p className="library_hint">The owner controls library settings and visibility.</p>
              </div>

              <div className="form_group library_name_group">
                <label htmlFor="libraryName">Library name *</label>
                <input
                  id="libraryName"
                  type="text"
                  value={libraryName}
                  maxLength={TITLE_LIMIT}
                  onChange={(e) => setLibraryName(e.target.value)}
                  placeholder="Example: Marketing notes"
                />
                <div className="field_meta_row">
                  <p
                    className={`character_count ${
                      isDuplicateName ? "error" : titleCountClass
                    }`}
                  >
                    {isDuplicateName
                      ? "This library name already exists."
                      : `${libraryName.length} / ${TITLE_LIMIT} characters`}
                  </p>
                  {(isDuplicateName ||
                    trimmedLibraryName.length > 0 ||
                    hasAttemptedSubmit) && (
                    <span>
                      {isDuplicateName
                        ? "Unavailable"
                        : trimmedLibraryName.length > 0
                          ? "Ready"
                          : "Required"}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="form_group description_group">
              <label htmlFor="libraryDescription">Description</label>
              <textarea
                id="libraryDescription"
                value={description}
                maxLength={DESCRIPTION_LIMIT}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Write a short description for this library"
              />
              <div className="description_meter" aria-hidden="true">
                <span style={{ width: `${descriptionProgress}%` }} />
              </div>
              <p
                className={
                  description.length > DESCRIPTION_LIMIT
                    ? "character_count error"
                    : "character_count"
                }
              >
                {description.length} / {DESCRIPTION_LIMIT} characters
              </p>
            </div>
          </section>

          <section className="form_section">
            <div className="form_section_header">
              <div>
                <span className="section_number">02</span>
                <h2>Publishing</h2>
                <p>Control whether this library can be published publicly.</p>
              </div>
            </div>

            <label className="publish_control">
              <span className="publish_control_copy">
                <strong>Allow publish</strong>
              </span>
              <input
                type="checkbox"
                checked={visibility === "public"}
                onChange={(event) =>
                  setVisibility(event.target.checked ? "public" : "private")
                }
              />
              <span className="publish_switch" aria-hidden="true">
                <span />
              </span>
            </label>
          </section>

          <div className="create_library_actions">
            <button type="button" className="return_library_btn" onClick={handleReturn}>
              Return
            </button>
            <button
              type="button"
              className="create_form_import_btn"
              onClick={() =>
                navigate("/dashboard/import-library", {
                  state: { from: location.state?.from || "/dashboard/libraries" },
                })
              }
            >
              <i className="ti-import" />
              Import library
            </button>
            <button type="submit" className="create_library_btn">
              <LuBookPlus aria-hidden="true" />
              Create library
            </button>
          </div>
        </form>
      </section>
      <ActionPopup
        popup={limitPopup}
        onResolve={() => setLimitPopup(null)}
      />
    </main>
  );
}

export default CreateLibraryPage;
