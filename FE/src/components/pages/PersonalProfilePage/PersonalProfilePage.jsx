import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getMyProfile,
  getProfileById,
  updateMyAvatar,
  updateMyProfile,
} from "../../../utils/profileApi";
import defaultAvatar from "../../../assets/images/account.png";
import { getStoredUser } from "../../../utils/authToken.js";
import "./PersonalProfilePage.css";

const PROFILE_BIO_KEY = "aiStudyHubProfileBio";
const PROFILE_NAME_KEY = "aiStudyHubProfileName";

function getLocalStoredUser() {
  return getStoredUser() || {};
}

function getLoggedInUserId() {
  const storedUser = getStoredUser();
  return storedUser?.id || storedUser?._id || storedUser?.user_id || "";
}

function getLoggedInUserEmail() {
  return getStoredUser()?.email || "";
}

function getStoredProfileBio() {
  const storedUser = getStoredUser();
  return storedUser?.bio || localStorage.getItem(PROFILE_BIO_KEY) || "";
}

function getStoredProfileName() {
  const storedUser = getStoredUser();
  return (
    localStorage.getItem(PROFILE_NAME_KEY) ||
    storedUser.full_name ||
    storedUser.username ||
    "User"
  );
}

function PersonalProfile() {
  const navigate = useNavigate();
  const { id: profileId } = useParams();
  const loggedInUserId = getLoggedInUserId();
  const isOwnProfile = !profileId || profileId === loggedInUserId;

  const [userName, setUserName] = useState(getStoredProfileName);
  const [userEmail, setUserEmail] = useState(getLoggedInUserEmail);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [isDateOfBirthPublic, setIsDateOfBirthPublic] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(userName);
  const [profileBio, setProfileBio] = useState(getStoredProfileBio);
  const [draftBio, setDraftBio] = useState(getStoredProfileBio);
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [bioStatus, setBioStatus] = useState("");
  const [avatar, setAvatar] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  const imgRef = useRef(null);
  const [libraries, setLibraries] = useState([]);
  const [showAllLibraries, setShowAllLibraries] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      try {
        const profileData = isOwnProfile
          ? await getMyProfile()
          : await getProfileById(profileId);
        if (!isMounted) return;

        const profile = isOwnProfile ? profileData : profileData?.profile;
        const sharedLibraries = isOwnProfile
          ? JSON.parse(localStorage.getItem("aiStudyHubLibraries") || "[]").filter(
              (library) => library.shareOnProfile === true,
            )
          : profileData?.libraries || [];
        const nextAvatar = profile?.avatar_url || "";
        const nextName =
          profile?.full_name || profile?.username || profile?.email || "User";

        setUserName(nextName);
        setNewName(nextName);
        setUserEmail(profile?.email || "");
        setDateOfBirth(profile?.date_of_birth || "");
        setIsDateOfBirthPublic(profile?.is_dob_public !== false);
        setProfileBio(profile?.bio || "");
        setDraftBio(profile?.bio || "");
        setAvatar(nextAvatar);
        setLibraries(sharedLibraries);
        setShowAllLibraries(false);

        if (isOwnProfile) {
          window.dispatchEvent(
            new CustomEvent("aiStudyHubProfileChanged", {
              detail: { avatar: nextAvatar },
            }),
          );
        }
      } catch (error) {
        console.error("Cannot load profile:", error);
      }
    }

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [isOwnProfile, profileId]);

  async function handleChangeAvatar(e) {
    if (!isOwnProfile) return;

    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(reader.result);
      setIsCropModalOpen(true);
    };
    reader.readAsDataURL(file);

    e.target.value = "";
  }

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    setIsDragging(true);
    setDragStart({ x: e.touches[0].clientX - pos.x, y: e.touches[0].clientY - pos.y });
  };

  const handleTouchMove = (e) => {
    if (!isDragging || e.touches.length !== 1) return;
    setPos({ x: e.touches[0].clientX - dragStart.x, y: e.touches[0].clientY - dragStart.y });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleImageLoaded = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    const containerSize = 300;
    let w = containerSize;
    let h = containerSize;

    if (naturalWidth > naturalHeight) {
      h = containerSize;
      w = (naturalWidth / naturalHeight) * containerSize;
    } else {
      w = containerSize;
      h = (naturalHeight / naturalWidth) * containerSize;
    }

    setImgSize({ width: w, height: h });
    setPos({ x: 0, y: 0 });
    setZoom(1);
  };

  const handleSaveCrop = () => {
    if (!imgRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");

    // Dịch chuyển canvas về tâm
    ctx.translate(200, 200);

    // Tỉ lệ scale từ 250px (crop circle trên UI) lên 400px (canvas thực tế)
    const screenToCanvas = 400 / 250;

    ctx.scale(zoom * screenToCanvas, zoom * screenToCanvas);
    ctx.translate(pos.x / zoom, pos.y / zoom);

    ctx.drawImage(
      imgRef.current,
      -imgSize.width / 2,
      -imgSize.height / 2,
      imgSize.width,
      imgSize.height
    );

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], "avatar.jpg", { type: "image/jpeg" });
      try {
        setIsUploadingAvatar(true);
        setIsCropModalOpen(false);

        const profile = await updateMyAvatar(file);
        const nextAvatar = profile?.avatar_url || "";
        setAvatar(nextAvatar);

        window.dispatchEvent(
          new CustomEvent("aiStudyHubProfileChanged", {
            detail: { avatar: nextAvatar },
          })
        );
      } catch (error) {
        console.error("Cannot update avatar:", error);
        alert(error.response?.data?.message || "Cannot update avatar. Please try again.");
      } finally {
        setIsUploadingAvatar(false);
      }
    }, "image/jpeg", 0.9);
  };

  async function handleSaveName() {
    if (!isOwnProfile) return;

    const trimmedName = newName.trim();

    try {
      const profile = await updateMyProfile({ full_name: trimmedName });
      const nextName =
        profile?.full_name || profile?.username || profile?.email || trimmedName;

      setUserName(nextName);
      setNewName(nextName);
      localStorage.setItem(PROFILE_NAME_KEY, nextName);
      setIsEditingName(false);
    } catch (error) {
      console.error("Cannot update profile name:", error);
      alert(error.response?.data?.message || "Cannot update profile name.");
    }
  }

  async function handleSaveBio() {
    if (!isOwnProfile) return;

    const trimmedBio = draftBio.trim();
    const wordCount = trimmedBio === "" ? 0 : trimmedBio.split(/\s+/).length;
    setBioStatus("");

    if (wordCount > 350) {
      setBioStatus("Bio must be 350 words or fewer.");
      return;
    }

    try {
      setIsSavingBio(true);
      const profile = await updateMyProfile({ bio: trimmedBio });
      const nextBio = profile?.bio || trimmedBio;

      setProfileBio(nextBio);
      setDraftBio(nextBio);
      localStorage.setItem(PROFILE_BIO_KEY, nextBio);
      setIsEditingBio(false);
      setBioStatus("Bio updated.");
    } catch (error) {
      console.error("Cannot update profile bio:", error);
      setBioStatus(error.response?.data?.message || "Cannot update bio.");
    } finally {
      setIsSavingBio(false);
    }
  }

  function handleCancelBioEdit() {
    setDraftBio(profileBio);
    setBioStatus("");
    setIsEditingBio(false);
  }

  const displayAvatar = avatar || defaultAvatar;
  const birthdayText =
    dateOfBirth && (isOwnProfile || isDateOfBirthPublic)
      ? new Date(dateOfBirth).toDateString()
      : "Birthday unavailable";
  const bioWordCount = draftBio.trim() === "" ? 0 : draftBio.trim().split(/\s+/).length;
  const sortedLibraries = [...libraries].sort(
    (a, b) => getLibraryStars(b) - getLibraryStars(a),
  );
  const visibleLibraries = showAllLibraries
    ? sortedLibraries
    : sortedLibraries.slice(0, 2);

  return (
    <main className="profile_page">
      <aside className="profile_sidebar">
        <label className="profile_main_avatar">
          <img
            src={displayAvatar}
            alt="User avatar"
            className={avatar ? "" : "default_profile_avatar"}
          />

          {isOwnProfile && (
            <>
              <div className="avatar_overlay">
                {isUploadingAvatar ? "Uploading..." : "Change avatar"}
              </div>

              <input type="file" accept="image/*" onChange={handleChangeAvatar} />
            </>
          )}
        </label>

        <div className="profile_name_area">
          <div className="profile_name_row">
            <h2>{userName}</h2>
            <h2>{userEmail || "Email unavailable"}</h2>
            <h2>{birthdayText}</h2>
          </div>
        </div>

      </aside>

      <section className="profile_content">
        <div className="libraries_section">
          <div className="libraries_header">
            <h3>Shared libraries</h3>
            {libraries.length > 2 && (
              <button
                type="button"
                className="show_all_libraries_btn"
                onClick={() => setShowAllLibraries((current) => !current)}
              >
                {showAllLibraries ? "Show less" : "Show all library"}
              </button>
            )}
          </div>

          {libraries.length === 0 ? (
            <div className="profile_empty_library">
              <h3>No library upload</h3>
            </div>
          ) : (
            <div className="library_grid">
              {visibleLibraries.map((library) => (
                <LibraryCard
                  key={library.id || library.name}
                  library={library}
                  onView={() => navigate(`/dashboard/libraries/${library.id}`)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="profile_bio_panel">
          <div className="profile_bio_header">
            <h3>About me</h3>
            {isOwnProfile && !isEditingBio && (
              <button type="button" onClick={() => setIsEditingBio(true)}>
                Edit
              </button>
            )}
          </div>

          {isEditingBio ? (
            <div className="profile_bio_editor">
              <textarea
                value={draftBio}
                onChange={(e) => setDraftBio(e.target.value)}
                placeholder="Write a short description about yourself..."
              />

              <div className="profile_bio_meta">
                <span className={bioWordCount > 350 ? "over_limit" : ""}>
                  {bioWordCount} / 350 word
                </span>

                <div>
                  <button
                    type="button"
                    onClick={handleSaveBio}
                    disabled={isSavingBio}
                  >
                    {isSavingBio ? "Saving..." : "Save"}
                  </button>
                  <button type="button" onClick={handleCancelBioEdit}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="profile_bio_view">
              <p>{profileBio || "No bio yet."}</p>
            </div>
          )}

          {bioStatus && <p className="profile_bio_status">{bioStatus}</p>}
        </div>
      </section>

      {isCropModalOpen && (
        <div className="crop_modal_overlay">
          <div className="crop_modal_content">
            <h3>Edit photo</h3>
            <p>Drag to reposition and use the slider to scale.</p>

            <div
              className="crop_container"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <img
                ref={imgRef}
                src={cropSrc}
                alt="To Crop"
                onLoad={handleImageLoaded}
                style={{
                  width: imgSize.width ? `${imgSize.width}px` : "auto",
                  height: imgSize.height ? `${imgSize.height}px` : "auto",
                  transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
                }}
                className="crop_image"
                draggable={false}
              />
              <div className="crop_overlay"></div>
            </div>

            <div className="crop_slider_control">
              <i className="ti-minus" onClick={() => setZoom(prev => Math.max(1, prev - 0.1))}></i>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
              />
              <i className="ti-plus" onClick={() => setZoom(prev => Math.min(3, prev + 0.1))}></i>
            </div>

            <div className="crop_modal_actions">
              <button type="button" className="btn_cancel" onClick={() => setIsCropModalOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn_save" onClick={handleSaveCrop}>
                Save avatar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function getLibraryStars(library) {
  return Number(library?.stars || library?.star_count || library?.starCount || 0);
}

function LibraryCard({ library, onView }) {
  return (
    <div className="library_profile_card">
      <div className="library_card_title">
        <h4>{library.name}</h4>
        <span>{library.visibility === "private" ? "Private" : "Public"}</span>
      </div>

      {library.description && (
        <p className="library_description">{library.description}</p>
      )}

      <button type="button" className="library_view_btn" onClick={onView}>
        View
      </button>
    </div>
  );
}

export default PersonalProfile;
